from django.contrib import admin
from django.urls import include, path

from core.views import healthz

urlpatterns = [
    path("", include("notes.urls")),
    path("healthz", healthz, name="healthz"),
    path("admin/", admin.site.urls),
]
