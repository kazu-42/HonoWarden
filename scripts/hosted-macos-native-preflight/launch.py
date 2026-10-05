#!/usr/bin/env python3
"""Child launch gate: EOF before recorded GO cannot start an app or Worker."""

import os
import select
import sys


def await_go(stream, timeout=10):
    if not select.select([stream], [], [], timeout)[0]:
        return False
    # No bearer or fixture secret enters this gate; the entire protocol is one public line.
    return os.read(stream.fileno(), 4) == b"GO\n"


def main():
    if not await_go(sys.stdin.buffer):
        return 1
    arguments = sys.argv[1:]
    worker_input = bool(arguments and arguments[0] == "--worker-input")
    if worker_input:
        arguments = arguments[1:]
        companion = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "worker.mjs")
        if (len(arguments) != 5 or os.path.basename(arguments[0]) != "node"
                or arguments[1] != companion
                or not all(os.path.isabs(v) for v in arguments[:4])
                or arguments[4] not in {"minimal", "company"}):
            return 1
    if not arguments or not os.path.isabs(arguments[0]):
        return 1
    if not worker_input:
        fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(fd, 0)
        os.close(fd)
    os.execve(arguments[0], arguments, os.environ)


if __name__ == "__main__":
    sys.exit(main())
