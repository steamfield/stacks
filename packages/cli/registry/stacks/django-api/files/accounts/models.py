from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """The project's user model (AUTH_USER_MODEL).

    It exists from the first migration because swapping the user model later means rewriting
    every migration that references it. Add profile fields here.
    """
