output "cloud_run_service" {
  value = google_cloud_run_v2_service.app.name
}

output "cloud_sql_instance" {
  value = google_sql_database_instance.postgres.name
}

output "redis_instance" {
  value = google_redis_instance.cache.name
}
