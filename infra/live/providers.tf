provider "aws" {
  region = "mx-central-1"

  default_tags {
    tags = {
      Project   = "family-party"
      ManagedBy = "terraform"
      Stack     = "live"
    }
  }
}
