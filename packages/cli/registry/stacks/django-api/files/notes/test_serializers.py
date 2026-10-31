from notes.serializers import NoteSerializer


def test_trims_the_title_and_defaults_nothing_else() -> None:
    serializer = NoteSerializer(data={"title": "  Milk  "})
    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data == {"title": "Milk"}


def test_refuses_unknown_fields_before_field_rules() -> None:
    serializer = NoteSerializer(data={"title": "", "body": "x" * 10_001, "colour": "red"})
    assert not serializer.is_valid()
    assert set(serializer.errors) == {"colour"}


def test_reports_field_rules_once_the_keys_are_known() -> None:
    serializer = NoteSerializer(data={"title": "", "body": "x" * 10_001})
    assert not serializer.is_valid()
    assert set(serializer.errors) == {"title", "body"}


def test_read_only_fields_are_refused_on_input() -> None:
    serializer = NoteSerializer(data={"title": "ok", "id": "1", "createdAt": "2020-01-01"})
    assert not serializer.is_valid()
    assert set(serializer.errors) == {"id", "createdAt"}
