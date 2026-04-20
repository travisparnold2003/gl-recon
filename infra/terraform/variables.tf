variable "prefix" {
  description = "Resource naming prefix"
  type        = string
  default     = "gl-recon"
}

variable "gcp_project_id" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "Deployment region"
  type        = string
  default     = "europe-west1"
}

variable "container_image" {
  description = "Cloud Run container image"
  type        = string
}

variable "database_url" {
  description = "Runtime database URL"
  type        = string
}

variable "redis_url" {
  description = "Runtime Redis URL"
  type        = string
  default     = ""
}

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "vpc_network" {
  description = "VPC network self link for Redis"
  type        = string
  default     = "projects/default/global/networks/default"
}
