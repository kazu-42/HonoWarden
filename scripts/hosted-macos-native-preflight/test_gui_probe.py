"""Exercise the GUI session predicate against the installed Apple SDK."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(sys.platform == "darwin" and shutil.which("swift"), "Apple SDK required")
class ConsoleSessionTests(unittest.TestCase):
    def test_sdk_dictionary_key_and_missing_session(self):
        source = Path(__file__).with_name("gui-probe.swift").read_text()
        predicate = source.split("let pid =", 1)[0]
        fixtures = '''
assert(isConsoleSession([kCGSessionOnConsoleKey as String: true]))
assert(!isConsoleSession([kCGSessionOnConsoleKey as String: false]))
assert(!isConsoleSession(["kCGSessionOnConsoleKey": true]))
assert(!isConsoleSession([kCGSessionOnConsoleKey as String: "true"]))
assert(!isConsoleSession([:]))
assert(!isConsoleSession(nil))
print("console_session_predicate_passed")
'''
        with tempfile.TemporaryDirectory(prefix="honowarden-gui-predicate-") as directory:
            script = Path(directory) / "main.swift"
            script.write_text(predicate + fixtures)
            result = subprocess.run(
                ["swift", str(script)], capture_output=True, text=True, timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "console_session_predicate_passed")


if __name__ == "__main__":
    unittest.main()
