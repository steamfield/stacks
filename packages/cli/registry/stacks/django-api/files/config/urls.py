from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularJSONAPIView

from core.views import healthz

urlpatterns = [
    path("v1/", include("notes.urls")),
    path("healthz", healthz, name="healthz"),
    path("openapi.json", SpectacularJSONAPIView.as_view(), name="openapi"),
    path("admin/", admin.site.urls),
]

# JSON instead of Django's HTML pages for misses, bad hosts and unexpected errors (DEBUG off).
handler400 = "core.views.bad_request"
handler403 = "core.views.permission_denied"
handler404 = "core.views.not_found"
handler500 = "core.views.server_error"
