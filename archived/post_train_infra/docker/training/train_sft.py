#!/usr/bin/env python3
"""
Supervised Fine-Tuning (SFT) script for Qwen2.5-7B model.

This script performs supervised fine-tuning on the Qwen2.5-7B model using
instruction-following data in JSONL format.
"""

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import torch
import boto3
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Qwen2.5-7B Supervised Fine-Tuning")

    # Model arguments
    parser.add_argument(
        "--model_name_or_path",
        type=str,
        default="Qwen/Qwen2.5-7B",
        help="Model identifier from huggingface.co/models",
    )

    # Data arguments
    parser.add_argument(
        "--data_path",
        type=str,
        required=True,
        help="Path to training data (S3 or local path)",
    )
    parser.add_argument(
        "--max_seq_length",
        type=int,
        default=2048,
        help="Maximum sequence length",
    )

    # Output arguments
    parser.add_argument(
        "--output_dir",
        type=str,
        required=True,
        help="Output directory for final model (S3 or local path)",
    )
    parser.add_argument(
        "--checkpoint_dir",
        type=str,
        required=True,
        help="Checkpoint directory for intermediate saves (S3 or local path)",
    )

    # Training arguments
    parser.add_argument(
        "--num_train_epochs",
        type=int,
        default=3,
        help="Number of training epochs",
    )
    parser.add_argument(
        "--per_device_train_batch_size",
        type=int,
        default=4,
        help="Batch size per GPU",
    )
    parser.add_argument(
        "--gradient_accumulation_steps",
        type=int,
        default=4,
        help="Gradient accumulation steps",
    )
    parser.add_argument(
        "--learning_rate",
        type=float,
        default=2e-5,
        help="Learning rate",
    )
    parser.add_argument(
        "--warmup_steps",
        type=int,
        default=100,
        help="Warmup steps",
    )
    parser.add_argument(
        "--logging_steps",
        type=int,
        default=10,
        help="Logging steps",
    )
    parser.add_argument(
        "--save_steps",
        type=int,
        default=100,
        help="Save checkpoint every N steps",
    )
    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Use FP16 mixed precision",
    )
    parser.add_argument(
        "--use_lora",
        action="store_true",
        default=True,
        help="Use LoRA for parameter-efficient fine-tuning",
    )

    return parser.parse_args()


def load_training_data(data_path, tokenizer, max_seq_length):
    """Load and preprocess training data from S3 or local path."""
    logger.info(f"Loading training data from {data_path}")

    # Load dataset from JSONL
    if data_path.startswith("s3://"):
        # Download from S3 to local temp directory first
        s3 = boto3.client("s3")
        bucket, key = data_path.replace("s3://", "").split("/", 1)
        local_path = "/tmp/train_data.jsonl"
        s3.download_file(bucket, key, local_path)
        dataset = load_dataset("json", data_files=local_path, split="train")
    else:
        dataset = load_dataset("json", data_files=data_path, split="train")

    logger.info(f"Loaded {len(dataset)} examples")

    # Tokenize dataset
    def tokenize_function(examples):
        # Assuming JSONL format with "text" field
        # You may need to adjust this based on your data format
        return tokenizer(
            examples["text"],
            truncation=True,
            max_length=max_seq_length,
            padding="max_length",
        )

    tokenized_dataset = dataset.map(
        tokenize_function,
        batched=True,
        remove_columns=dataset.column_names,
    )

    return tokenized_dataset


def setup_lora_model(model, lora_r=8, lora_alpha=16, lora_dropout=0.1):
    """Setup LoRA for parameter-efficient fine-tuning."""
    logger.info("Setting up LoRA configuration")

    lora_config = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
    )

    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, lora_config)

    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in model.parameters())
    logger.info(
        f"Trainable params: {trainable_params:,} / {total_params:,} "
        f"({100 * trainable_params / total_params:.2f}%)"
    )

    return model


def upload_to_s3(local_dir, s3_path):
    """Upload directory to S3."""
    if not s3_path.startswith("s3://"):
        return

    logger.info(f"Uploading {local_dir} to {s3_path}")
    s3 = boto3.client("s3")
    bucket, prefix = s3_path.replace("s3://", "").split("/", 1)

    for root, dirs, files in os.walk(local_dir):
        for file in files:
            local_file = os.path.join(root, file)
            relative_path = os.path.relpath(local_file, local_dir)
            s3_key = f"{prefix}/{relative_path}"
            s3.upload_file(local_file, bucket, s3_key)

    logger.info(f"Upload complete: {s3_path}")


def main():
    """Main training function."""
    args = parse_args()

    logger.info("=" * 80)
    logger.info("Qwen2.5-7B Supervised Fine-Tuning")
    logger.info("=" * 80)
    logger.info(f"Model: {args.model_name_or_path}")
    logger.info(f"Data: {args.data_path}")
    logger.info(f"Output: {args.output_dir}")
    logger.info(f"Checkpoints: {args.checkpoint_dir}")
    logger.info(f"GPU available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        logger.info(f"GPU device: {torch.cuda.get_device_name(0)}")
        logger.info(f"GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")

    # Load tokenizer
    logger.info("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(
        args.model_name_or_path,
        trust_remote_code=True,
        use_fast=False,
    )
    tokenizer.pad_token = tokenizer.eos_token

    # Load model
    logger.info("Loading model...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model_name_or_path,
        trust_remote_code=True,
        torch_dtype=torch.float16 if args.fp16 else torch.float32,
        device_map="auto",
    )

    # Setup LoRA if enabled
    if args.use_lora:
        model = setup_lora_model(model)

    # Load training data
    train_dataset = load_training_data(args.data_path, tokenizer, args.max_seq_length)

    # Setup training arguments
    local_checkpoint_dir = "/tmp/checkpoints"
    local_output_dir = "/tmp/output"

    training_args = TrainingArguments(
        output_dir=local_checkpoint_dir,
        num_train_epochs=args.num_train_epochs,
        per_device_train_batch_size=args.per_device_train_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        warmup_steps=args.warmup_steps,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        save_total_limit=3,
        fp16=args.fp16,
        report_to=["tensorboard"],
        logging_dir=f"{local_checkpoint_dir}/logs",
        remove_unused_columns=False,
    )

    # Initialize trainer
    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        data_collator=data_collator,
    )

    # Train
    logger.info("Starting training...")
    start_time = datetime.now()

    trainer.train()

    end_time = datetime.now()
    logger.info(f"Training completed in {end_time - start_time}")

    # Save final model
    logger.info("Saving final model...")
    trainer.save_model(local_output_dir)
    tokenizer.save_pretrained(local_output_dir)

    # Upload to S3 if needed
    if args.output_dir.startswith("s3://"):
        upload_to_s3(local_output_dir, args.output_dir)

    if args.checkpoint_dir.startswith("s3://"):
        upload_to_s3(local_checkpoint_dir, args.checkpoint_dir)

    logger.info("Training pipeline completed successfully!")


if __name__ == "__main__":
    main()
