terraform {
  required_version = ">= 1.10" # S3 native locking needs 1.10+

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0" # any 6.x, never a surprise 7.0
    }
  }
}

provider "aws" {
  region = "mx-central-1"

  # Stamped on every resource this provider creates
  default_tags {
    tags = {
      Project   = "family-party"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "sfmb-family-party-tfstate" # globally unique across all of AWS

  lifecycle {
    prevent_destroy = true # terraform refuses to delete this
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled" # every state change keeps the previous version
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}
