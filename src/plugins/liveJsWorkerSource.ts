/**
 * The live-js worker, shipped as a string: the runner page
 * (./liveJsRunner, inside a sandboxed iframe) starts it from a blob: URL,
 * and unit tests pin its throw/rejection containment and lockdown
 * properties textually (jsdom can't run a real Worker).
 */
export const WORKER_SOURCE = `
// A blob: worker inherits the page CSP, including
// require-trusted-types-for 'script'. Running the fence body through
// new Function() is this worker's whole purpose (it is isolated from the
// page and has no DOM), so give it a default policy that accepts scripts.
if (self.trustedTypes && !self.trustedTypes.defaultPolicy) {
  try {
    self.trustedTypes.createPolicy("default", {
      createScript: function(s) { return s; },
    });
  } catch (e) {}
}

// Lock the run down before any user code exists. The real boundary is the
// runner iframe (opaque origin, CSP connect-src 'none' — see
// livejs-runner.html); this removes the network and storage APIs from the
// worker as a second layer, also in dev where no CSP header is served.
(function() {
  var names = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport",
    "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker"];
  var targets = [];
  for (var o = self; o; o = Object.getPrototypeOf(o)) targets.push(o);
  names.forEach(function(name) {
    targets.forEach(function(t) {
      try { Object.defineProperty(t, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
    });
  });
})();

// Everything the runtime needs lives inside this IIFE, so none of it sits
// in the global scope that user code shares: "live-js shared" blocks keep
// their top-level bindings as globals, and a user's "const emit = ..." must
// neither collide with nor clobber the runtime.
(function() {
  var post = self.postMessage.bind(self);
  var closeWorker = self.close.bind(self);
  var setT = setTimeout;
  var clearT = clearTimeout;

  var toParts = function(args) {
    var list = Array.prototype.slice.call(args);
    return list.map(function(a) {
      if (a === undefined) return "undefined";
      if (a === null) return "null";
      if (typeof a === "string") return a;
      if (typeof a === "function") return "[Function " + (a.name || "anonymous") + "]";
      try {
        return JSON.stringify(a, null, 2);
      } catch (e) {
        return String(a);
      }
    });
  };

  var emit = function(level, args, runId) {
    try {
      post({
        type: "log",
        runId: runId,
        level: level,
        parts: toParts(args),
      });
    } catch (e) {}
  };

  self.addEventListener("message", function(event) {
    var payload = event.data || {};
    if (payload.type !== "run") return;

    var runId = payload.runId || 0;
    var source = String(payload.source || "");
    var timeoutMs = Number(payload.timeoutMs || 0);
    var timer = timeoutMs > 0 ? setT(function() {
      emit("error", ["Execution timed out"], runId);
      post({ type: "done", runId: runId, timedOut: true });
      closeWorker();
    }, timeoutMs) : null;

    self.onerror = function(msg, filename, lineno, colno) {
      emit("error", [String(msg) + " (" + (filename || "inline") + ":" + (lineno || 0) + ":" + (colno || 0) + ")"], runId);
      // Returning true suppresses the default action so the error does NOT
      // bubble up to the parent (which would surface as a pageerror).
      return true;
    };
    self.onunhandledrejection = function(e) {
      var reason = e && e.reason ? e.reason : e;
      emit("error", ["Unhandled rejection: " + (reason && reason.message ? reason.message : String(reason))], runId);
      // Same as onerror — prevent default to keep the rejection from
      // escaping the worker and surfacing as a pageerror in the parent.
      if (e && typeof e.preventDefault === "function") e.preventDefault();
    };

    var finish = function() {
      if (timer) clearT(timer);
      post({ type: "done", runId: runId });
    };

    try {
      var safeConsole = {
        log: function() { emit("log", arguments, runId); },
        info: function() { emit("info", arguments, runId); },
        warn: function() { emit("warn", arguments, runId); },
        error: function() { emit("error", arguments, runId); },
      };
      // Note the leading "return" — without it, the async IIFE's promise is
      // discarded and any rejection (e.g. user code throwing) becomes an
      // unhandled rejection in the worker, which propagates as a worker
      // error and surfaces as pageerror in the parent. With "return", the
      // outer .then(_, errHandler) catches it cleanly.
      var runner = new Function(
        "console",
        "return (async function() {\\n" + source + "\\n})();"
      );
      Promise.resolve().then(function() { return runner(safeConsole); }).then(
        finish,
        function(err) {
          emit("error", [err && err.stack ? err.stack : String(err)], runId);
          finish();
        },
      );
    } catch (err) {
      emit("error", [err && err.stack ? err.stack : String(err)], runId);
      finish();
    }
  });
})();
`;
