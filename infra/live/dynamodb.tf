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

resource "aws_dynamodb_table" "connections" {
  name         = "family-party-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }

  global_secondary_index {
    name            = "byRoom"
    hash_key        = "roomCode"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt" # the handler sets it to now + 2h
    enabled        = true
  }
}
