terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "sfmb-family-party-tfstate"
    key          = "ci/terraform.tfstate"      # its own state, separate from live
    region       = "mx-central-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = "mx-central-1"
  default_tags {
    tags = { Project = "family-party", ManagedBy = "terraform", Stack = "ci" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  repo       = "SFMB-9/family-party"
  account_id = data.aws_caller_identity.current.account_id
  region     = "mx-central-1"
  state_arn  = "arn:aws:s3:::sfmb-family-party-tfstate"
}
