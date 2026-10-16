import sys
from pathlib import Path

from app.core.config import get_settings
from app.services.audit import init_db
from app.services.knowledge import ingest_bytes
from app.services.ingestion import SUPPORTED


def main() -> None:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(get_settings().sample_kb_dir)
    init_db()
    files = [p for p in sorted(folder.iterdir()) if p.is_file() and p.suffix.lower() in SUPPORTED]
    total = 0
    for path in files:
        doc = ingest_bytes(path.name, path.read_bytes(), origin="sample", path=str(path))
        total += doc["chunks"]
        print(f"{path.name}: {doc['chunks']} chunks")
    print(f"Indexed {len(files)} files -> {total} chunks")


if __name__ == "__main__":
    main()
