$url = "https://hubyywmodekfdzhwiumb.supabase.co"
$anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1Ynl5d21vZGVrZmR6aHdpdW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3ODkyNzgsImV4cCI6MjA4ODM2NTI3OH0.M6UQcpMLCCFja9TdeJpxawUvKhso38BmMGFJi6lLbrc"

$headers = @{
    "apikey" = $anonKey
    "Authorization" = "Bearer $anonKey"
    "Content-Type" = "application/json"
}

$query = "select=engagement_id,client_name&client_name=ilike.*swastik*"
$uri = "$url/rest/v1/audit_engagements?$query"

$response = Invoke-RestMethod -Uri $uri -Headers $headers
$response | ForEach-Object { Write-Host "ID: $($_.engagement_id) | Client: $($_.client_name)" }
