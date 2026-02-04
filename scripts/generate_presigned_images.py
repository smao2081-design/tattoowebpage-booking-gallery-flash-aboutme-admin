#!/usr/bin/env python3
import boto3
import logging
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO)
s3_client = boto3.client('s3')

def generate_presigned_urls_for_images(bucket_name, expiration=3600):
    """
    Generates presigned URLs for image files in an S3 bucket.
    Returns dict {object_key: presigned_url} or None on error.
    """
    presigned_urls = {}
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket_name):
            for obj in page.get('Contents', []):
                key = obj.get('Key')
                if not key:
                    continue
                if key.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.heic', '.heif')):
                    try:
                        url = s3_client.generate_presigned_url(
                            'get_object',
                            Params={'Bucket': bucket_name, 'Key': key},
                            ExpiresIn=expiration
                        )
                        presigned_urls[key] = url
                    except ClientError as e:
                        logging.error("Failed to generate presigned URL for %s: %s", key, e)
        return presigned_urls
    except ClientError as e:
        logging.error("Failed to list objects in bucket %s: %s", bucket_name, e)
        return None

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('bucket', help='S3 bucket name')
    p.add_argument('--expiry', type=int, default=3600, help='Expiry seconds for presigned URLs')
    args = p.parse_args()

    out = generate_presigned_urls_for_images(args.bucket, args.expiry)
    if out is None:
        print("Error or no access to bucket.")
    elif not out:
        print(f"No image objects found in bucket {args.bucket}.")
    else:
        for k, v in out.items():
            print(f"{k}\n{v}\n")
