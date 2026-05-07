FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install torch CPU-only first (smaller image, avoids CUDA downloads)
RUN pip install --no-cache-dir \
    torch==2.3.1+cpu \
    torchaudio==2.3.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
# Install remaining deps (torch already installed above, pip will skip it)
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
