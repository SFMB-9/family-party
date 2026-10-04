# ---------------------------------------------------------------- private question packs
# Family questions never live in the public repo. They're JSON files in this bucket,
# readable only by the game Lambda and writable only by Salva's admin login.

data "aws_caller_identity" "current" {}

locals {
  packs_bucket = "family-party-packs-${data.aws_caller_identity.current.account_id}" # bucket names are global
  # Identity Center admin role, any region or suffix: the only principal that may upload packs.
  admin_role_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_AdministratorAccess_*"
}

resource "aws_s3_bucket" "packs" {
  bucket = local.packs_bucket
}

resource "aws_s3_bucket_public_access_block" "packs" {
  bucket                  = aws_s3_bucket.packs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "packs" {
  bucket = aws_s3_bucket.packs.id
  rule {
    object_ownership = "BucketOwnerEnforced" # no ACLs at all: only policies decide access
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "packs" {
  bucket = aws_s3_bucket.packs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "packs" {
  bucket = aws_s3_bucket.packs.id
  versioning_configuration {
    status = "Enabled" # an overwritten pack can be recovered
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "packs" {
  bucket = aws_s3_bucket.packs.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.packs]
}

# Explicit Deny beats any Allow, including the ReadOnlyAccess the CI roles carry.
data "aws_iam_policy_document" "packs_bucket" {
  statement {
    sid       = "HttpsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.packs.arn, "${aws_s3_bucket.packs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "OnlyGameAndAdminRead"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.packs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values   = [aws_iam_role.game_session.arn, local.admin_role_pattern]
    }
  }

  statement {
    sid       = "OnlyAdminWrites"
    effect    = "Deny"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.packs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values   = [local.admin_role_pattern]
    }
  }
}

resource "aws_s3_bucket_policy" "packs" {
  bucket     = aws_s3_bucket.packs.id
  policy     = data.aws_iam_policy_document.packs_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.packs]
}

output "packs_bucket" {
  description = "Where private packs go (the pack script's PACKS_BUCKET)."
  value       = aws_s3_bucket.packs.bucket
}
