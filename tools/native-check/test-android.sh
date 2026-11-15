#!/bin/bash
# Run the Android app's plain-Java unit tests offline (plans W11.P8, W11.P10):
# the classes in android/app/src/main/java that use no Android types, with
# their JUnit 4 tests from android/app/src/test/java. On a machine with the
# SDK, `cd android && ./gradlew test` runs the same tests.
# Usage: test-android.sh <repo>   (JUNIT_CP: junit + hamcrest jars, ':'-separated)
set -u
R=$1; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
CP=${JUNIT_CP:-$(ls /opt/gradle-*/lib/junit-4*.jar 2>/dev/null | head -1):$(ls /opt/gradle-*/lib/hamcrest-core-*.jar 2>/dev/null | head -1)}
MAIN=$R/android/app/src/main/java/com/lumen/editor; TEST=$R/android/app/src/test/java/com/lumen/editor
PLAIN=("$MAIN/CaptureQueue.java")
TESTS=$(cd "$TEST" && ls *Test.java | sed 's/\.java$//')
if ! javac -Xlint:all -Werror -cp "$CP" -d "$W" "${PLAIN[@]}" "$TEST"/*Test.java 2>"$W/javac.err"; then
  echo "FAIL javac"; grep -v "Picked up JAVA_TOOL_OPTIONS" "$W/javac.err"; exit 1
fi
java -cp "$W:$CP" org.junit.runner.JUnitCore $(for t in $TESTS; do echo com.lumen.editor.$t; done) 2>&1 | grep -v "Picked up JAVA_TOOL_OPTIONS"
exit "${PIPESTATUS[0]}"
