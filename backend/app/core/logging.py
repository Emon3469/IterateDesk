import logging


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    for noisy in ("httpx", "httpcore", "httpx2", "urllib3", "pinecone"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
