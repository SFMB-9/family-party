# ---------------- plan: read-only + the state lock ----------------
resource "aws_iam_role" "plan" {
  name               = "github-family-party-plan"
  assume_role_policy = data.aws_iam_policy_document.trust_plan.json
}

resource "aws_iam_role_policy_attachment" "plan_readonly" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [local.state_arn]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${local.state_arn}/live/*"]
  }
  statement {
    sid       = "LockFileOnly" # plan takes a lock, but can never overwrite the state itself
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_arn}/live/terraform.tfstate.tflock"]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  name   = "terraform-state"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}

# ---------------- apply: write access, scoped to family-party-* ----------------
resource "aws_iam_role" "apply" {
  name               = "github-family-party-apply"
  assume_role_policy = data.aws_iam_policy_document.trust_apply.json
}

resource "aws_iam_role_policy_attachment" "apply_readonly" {
  role       = aws_iam_role.apply.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess" # Describe/List calls during refresh
}

data "aws_iam_policy_document" "apply" {
  statement {
    sid       = "State"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [local.state_arn, "${local.state_arn}/live/*"]
  }
  statement {
    sid       = "DynamoDB"
    actions   = ["dynamodb:*"]
    resources = ["arn:aws:dynamodb:${local.region}:${local.account_id}:table/family-party-*"]
  }
  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${local.region}:${local.account_id}:function:family-party-*"]
  }
  statement {
    sid     = "Logs"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/family-party-*",
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/family-party-*:*",
    ]
  }
  statement {
    sid       = "ApiGateway" # API Gateway ARNs contain no name or account, so it can't be narrowed further
    actions   = ["apigateway:*"]
    resources = ["arn:aws:apigateway:${local.region}::/*"]
  }
  statement {
    sid       = "IamForAppRoles" # only roles named family-party-*, never the github-* CI roles
    actions   = ["iam:*Role*", "iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/family-party-*"]
  }
  statement {
    sid       = "AlertsTopic" # SNS topic + email subscription for alarms (subscription ARNs start with the topic's)
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:${local.region}:${local.account_id}:family-party-*"]
  }
  statement {
    sid       = "Alarms"
    actions   = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"]
    resources = ["arn:aws:cloudwatch:${local.region}:${local.account_id}:alarm:family-party-*"]
  }
  statement {
    sid       = "Budgets"
    actions   = ["budgets:*"]
    resources = ["arn:aws:budgets::${local.account_id}:budget/family-party-*"]
  }
  statement {
    sid = "PacksBucket"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:PutBucket*",
      "s3:DeleteBucketPolicy",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
    ]
    resources = ["arn:aws:s3:::family-party-packs-*"]
  }
}

resource "aws_iam_role_policy" "apply" {
  name   = "family-party-deploy"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}

output "plan_role_arn" { value = aws_iam_role.plan.arn }
output "apply_role_arn" { value = aws_iam_role.apply.arn }
