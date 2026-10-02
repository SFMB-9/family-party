terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  backend "s3" {
    bucket       = "sfmb-family-party-tfstate"
    key          = "live/terraform.tfstate" # path of the state file inside the bucket
    region       = "mx-central-1"
    use_lockfile = true # S3-native locking, no DynamoDB lock table needed
    encrypt      = true
  }
}
