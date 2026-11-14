# Decision: EU representative (GDPR Art. 27) and a DPO (W11.S11)

**Not legal advice.** These are the project's decisions as of November 2026,
written down so the clinic (W6.37) can confirm or reject them.

## EU representative (Art. 27): not appointed, now

Art. 27 applies to a controller outside the EU whose processing is related
to offering services to people in the EU (Art. 3(2)). Lumen is offered to
anyone, so it may apply.

Art. 27(2)(a) exempts processing that is occasional, doesn't include special
categories on a large scale, and is unlikely to result in a risk to people,
taking into account its nature, context, scope and purposes. Today:

- the project runs no public server (the relay and the share server are code
  only);
- the app processes nothing on the project's servers;
- feedback goes from the user to GitHub directly.

**Decision:** no representative is appointed now. **Trigger to revisit:**
the day a public relay or share server opens to users in the EU. That
server processes metadata of EU users continuously, so the exemption is
doubtful from then on. The project then appoints a representative before
launch, or keeps the server closed to the EU.

## DPO (Art. 37 GDPR; Amendment 13 to the Israeli Privacy Protection Law): not needed

A DPO is required for a public body, for core activities of regular and
systematic monitoring on a large scale, or for special categories on a large
scale. Amendment 13 has similar triggers, and adds data traders. None of
these apply:

- Lumen tracks no one: there are no accounts and no analytics;
- the servers hold encrypted content they can't read;
- the project is not a public body and doesn't trade in data.

**Decision:** no DPO. **Revisit** if any server starts to identify or track
users, or the project starts to process special categories in readable form.

## Who decides

The project owner. A recommendation from the clinic goes into
`legal/review-packet/recommendations.md` and becomes a task, done or
declined with a reason.
