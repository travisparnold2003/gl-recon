terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  project = var.gcp_project_id
  service = each.value
}

resource "google_sql_database_instance" "postgres" {
  name             = "${var.prefix}-pg"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier = var.cloud_sql_tier
  }

  deletion_protection = false
  depends_on          = [google_project_service.services]
}

resource "google_redis_instance" "cache" {
  name               = "${var.prefix}-redis"
  tier               = "BASIC"
  memory_size_gb     = 1
  region             = var.gcp_region
  redis_version      = "REDIS_7_0"
  authorized_network = var.vpc_network

  depends_on = [google_project_service.services]
}

resource "google_cloud_run_v2_service" "app" {
  name     = "${var.prefix}-api"
  location = var.gcp_region

  template {
    containers {
      image = var.container_image

      env {
        name  = "DATABASE_URL"
        value = var.database_url
      }

      env {
        name  = "REDIS_URL"
        value = var.redis_url
      }
    }
  }

  ingress = "INGRESS_TRAFFIC_ALL"
  depends_on = [google_project_service.services]
}
