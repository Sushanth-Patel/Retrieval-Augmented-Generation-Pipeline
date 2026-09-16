# RAG (Retrieval-Augmented Generation) Pipeline

A simple, production-ready system that lets you upload your own documents (PDFs, Word files, spreadsheets, web pages) and ask questions about them to get accurate, grounded AI answers backed by real citations.

🌐 **Live Deployment**: [https://retrieval-augmented-generation-pipeline.onrender.com](https://retrieval-augmented-generation-pipeline.onrender.com)

---

## 📌 What is RAG?

**RAG (Retrieval-Augmented Generation)** is an AI architecture that enhances Large Language Models (LLMs) by connecting them to external knowledge sources (such as internal company files, technical documents, or database records).

Standard AI models can only answer based on past training data and may hallucinate or give outdated answers. A RAG system solves this by **retrieving relevant facts from your own documents first**, injecting those facts into the prompt, and generating accurate, up-to-date responses.

---

## 🔄 How RAG Works (The Workflow)

```mermaid
flowchart TD
    subgraph Step1["1. Data Ingestion & Chunking"]
        Docs[Raw Documents: PDFs, DOCX, XLSX, Web] --> Extract[Text Extraction]
        Extract --> Chunk[Chunking: Text Segmentation]
    end

    subgraph Step2["2. Embedding & Vector Storage"]
        Chunk --> Embed[Embedding Generation: Vectors]
        Embed --> VectorDB[(Vector Database: ChromaDB)]
    end

    subgraph Step3["3. Query & Retrieval"]
        Query[User Question] --> QueryEmbed[Query Vector Conversion]
        QueryEmbed --> Search[Vector Similarity Retrieval]
        Search --> VectorDB
    end

    subgraph Step4["4. Augmented Generation & Safety"]
        VectorDB --> Context[Retrieved Context + User Query]
        Context --> LLM[LLM Generator]
        LLM --> Response[Grounded Response with Citations]
    end
```

### Workflow Steps

- **Data Ingestion**: Raw documents (like PDFs, Word, Excel, databases, or web pages) are collected and extracted into text.
- **Chunking**: Large documents are split into smaller, manageable text segments to improve search accuracy.
- **Embedding Generation**: An embedding model converts text chunks into numerical vectors that capture their semantic meaning.
- **Vector Storage**: The vectors and their text are stored in a Vector Database for fast similarity searches.
- **Retrieval**: When a user asks a question, the system converts the query into a vector and searches the database for the most relevant text chunks.
- **Augmented Generation**: The retrieved context and the original user query are combined into a prompt and sent to the LLM, which writes a grounded response.

---

### 🌐 Live Web Application

Access the live production web app on Render:  
👉 **[https://retrieval-augmented-generation-pipeline.onrender.com](https://retrieval-augmented-generation-pipeline.onrender.com)**

### 1. Installation

```bash
git clone https://github.com/Sushanth-Patel/Retrieval-Augmented-Generation-Pipeline.git
cd Retrieval-Augmented-Generation-Pipeline

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Run the Application

```bash
python app.py
```

Open your web browser and navigate to: **`http://localhost:8000`**

---

## ✨ Key Features & Capabilities

- **📄 Multi-Format Document Parsing**: Seamlessly ingests PDF, Word (.docx), Excel (.xlsx), Markdown, and plain text files.
- **🔍 Hybrid Vector & Keyword Search**: Integrates ChromaDB dense embeddings with BM25 keyword search for maximum retrieval accuracy.
- **🛡️ Built-in Security Guardrails**: Automatically screens prompt injection attacks and redacts sensitive PII (emails, phone numbers).
- **💻 Modern Web Interface**: Clean, responsive interactive web UI featuring real-time response rendering and document citation badges.

---

## 🤝 Contributing & Feedback

Contributions, suggestions, and feedback are always welcome! If you encounter any issues or have feature ideas:
1. Open an issue on [GitHub Issues](https://github.com/Sushanth-Patel/Retrieval-Augmented-Generation-Pipeline/issues).
2. Fork the repository and submit a Pull Request.

---

## 👨‍💻 Author & Acknowledgments

Developed by **[Sushanth Patel](https://github.com/Sushanth-Patel)**.  
If you find this project helpful, feel free to give it a ⭐️ on GitHub!
