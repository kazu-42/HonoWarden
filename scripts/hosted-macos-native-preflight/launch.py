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
    if not arguments or not os.path.isabs(arguments[0]):
        return 1
    fd = os.open(os.devnull, os.O_RDONLY)
    os.dup2(fd, 0)
    os.close(fd)
    os.execve(arguments[0], arguments, os.environ)


if __name__ == "__main__":
    sys.exit(main())
