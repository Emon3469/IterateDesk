from app.rag.vectorstore import embedding_dimension

if __name__ == "__main__":
    print(f"Embedding model cached ({embedding_dimension()} dims)")
