import json
import sys
from pathlib import Path

from app.main import create_app


def main() -> None:
    Path(sys.argv[1]).write_text(
        json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
