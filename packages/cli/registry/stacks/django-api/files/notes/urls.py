from rest_framework.routers import SimpleRouter

from notes.views import NoteViewSet

# Path converters (not regexes) keep log routes readable: /v1/notes/<str:noteId>.
router = SimpleRouter(trailing_slash=False, use_regex_path=False)
router.register("notes", NoteViewSet, basename="note")

urlpatterns = router.urls
