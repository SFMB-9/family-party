resource "aws_dynamodb_table" "rooms" {
  name         = "family-party-rooms"
  billing_mode = "PAY_PER_REQUEST" # pay per read/write; $0 when nobody's playing
  hash_key     = "roomCode"        # the partition key: "ABCD" → one game

  attribute {
    name = "roomCode"
    type = "S" # string
  }

  ttl {
    attribute_name = "expiresAt" # epoch seconds; DynamoDB deletes the item after this
    enabled        = true
  }
}
