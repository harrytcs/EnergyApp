"""
Serves the Tesla public key at the well-known path.
Tesla verifies domain ownership by fetching this endpoint.
"""
import boto3

ssm = boto3.client("ssm")

def handler(event, context):
    param = ssm.get_parameter(Name="/energyapp/tesla/public_key", WithDecryption=False)
    public_key = param["Parameter"]["Value"]
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/x-pem-file"},
        "body": public_key,
    }
