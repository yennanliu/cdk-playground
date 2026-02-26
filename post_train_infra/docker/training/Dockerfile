# Training container for Qwen2.5-7B Supervised Fine-Tuning
FROM nvcr.io/nvidia/pytorch:24.01-py3

# Set working directory
WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy training scripts
COPY train_sft.py .
COPY utils/ ./utils/

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV TRANSFORMERS_CACHE=/workspace/.cache
ENV HF_HOME=/workspace/.cache

# Create cache directory
RUN mkdir -p /workspace/.cache

# Default command (can be overridden)
CMD ["python", "train_sft.py", "--help"]
