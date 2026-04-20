# GCP Deployment Guide

Cloud Run + Cloud SQL (PostgreSQL) + Redis (Memorystore), provisioned with Terraform.

This is a reference deployment guide. The Terraform files in `infra/terraform/` are a scaffold — they define the correct resource topology but have not been applied to a live GCP project.

---

## Prerequisites

- Terraform >= 1.6
- `gcloud` authenticated to the target project
- An Artifact Registry repository for container images

---

## 1. Build and push the container image

```bash
npm ci && npm run build
docker build -t europe-west1-docker.pkg.dev/<PROJECT_ID>/gl-recon/gl-recon:latest .
docker push europe-west1-docker.pkg.dev/<PROJECT_ID>/gl-recon/gl-recon:latest
```

---

## 2. Configure Terraform variables

Create `infra/terraform/terraform.tfvars`:

```hcl
prefix          = "gl-recon"
gcp_project_id  = "<PROJECT_ID>"
gcp_region      = "europe-west1"
container_image = "europe-west1-docker.pkg.dev/<PROJECT_ID>/gl-recon/gl-recon:latest"
database_url    = "postgresql://<USER>:<PASS>@<HOST>:5432/gl_recon"
redis_url       = "redis://<REDIS_HOST>:6379/0"
```

---

## 3. Provision infrastructure

```bash
cd infra/terraform
terraform init
terraform plan
terraform apply
```

This creates:
- A Cloud Run v2 service serving the application
- A Cloud SQL PostgreSQL 16 instance
- A Redis 7 Memorystore instance (BASIC tier, 1 GB)
- Enables required GCP APIs: Cloud Run, Cloud SQL Admin, Redis, Artifact Registry

---

## 4. Post-deployment checks

```bash
# Health check
curl https://<CLOUD_RUN_URL>/api/health

# Seed sample data (first run only)
curl -X POST https://<CLOUD_RUN_URL>/api/reset
```

---

## 5. Production hardening checklist

- Store `DATABASE_URL`, `REDIS_URL`, and `OPENROUTER_API_KEY` in GCP Secret Manager and reference them from Cloud Run as secret mounts.
- Add Cloud Run IAM authentication (`--no-allow-unauthenticated`) and use Identity-Aware Proxy for internal-only APIs.
- Set `API_AUTH_TOKEN` in Cloud Run environment for the application-level auth layer.
- Add OpenTelemetry exporter (Cloud Trace) and configure logs-based alerting for error rates.
- Enable Cloud SQL automatic backups and point-in-time recovery.
- Set `deletion_protection = true` on the Cloud SQL instance (currently `false` for scaffold convenience).
