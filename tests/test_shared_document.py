import pytest

from src.scratchpad.shared_document import SharedDocument, SlotEntry, VALID_TIME_SLOTS


class TestSharedDocument:
    def test_empty_document_renders(self):
        doc = SharedDocument()
        assert doc.render() == "(empty document)"

    def test_write_section(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast at cafe")
        entries = doc._slots[1]["morning"]
        assert len(entries) == 1
        assert entries[0].agent == "food"
        assert entries[0].content == "Breakfast at cafe"

    def test_write_section_multiple_agents(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast")
        doc.write_section(day=1, time_slot="morning", agent="culture", content="Museum visit")
        entries = doc._slots[1]["morning"]
        assert len(entries) == 2
        assert entries[0].agent == "food"
        assert entries[1].agent == "culture"

    def test_write_section_invalid_slot(self):
        doc = SharedDocument()
        with pytest.raises(ValueError, match="Invalid time_slot"):
            doc.write_section(day=1, time_slot="brunch", agent="food", content="x")

    def test_render_with_agent_tags(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast")
        doc.write_section(day=1, time_slot="morning", agent="culture", content="Museum")
        rendered = doc.render(show_agent_tags=True)
        assert "[food] Breakfast" in rendered
        assert "[culture] Museum" in rendered

    def test_render_without_agent_tags(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast")
        rendered = doc.render(show_agent_tags=False)
        assert "Breakfast" in rendered
        assert "[food]" not in rendered

    def test_consolidate_section(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast")
        doc.write_section(day=1, time_slot="morning", agent="culture", content="Museum")
        doc.consolidate_section(day=1, time_slot="morning", content="Breakfast then museum")
        entries = doc._slots[1]["morning"]
        assert len(entries) == 1
        assert entries[0].agent == "facilitator"
        assert entries[0].content == "Breakfast then museum"

    def test_consolidate_section_invalid_slot(self):
        doc = SharedDocument()
        with pytest.raises(ValueError, match="Invalid time_slot"):
            doc.consolidate_section(day=1, time_slot="brunch", content="x")

    def test_version_increments(self):
        doc = SharedDocument()
        assert doc.version == 0
        doc.write_section(day=1, time_slot="morning", agent="a", content="x")
        assert doc.version == 1
        doc.write_section(day=1, time_slot="afternoon", agent="b", content="y")
        assert doc.version == 2
        doc.consolidate_section(day=1, time_slot="morning", content="merged")
        assert doc.version == 3

    def test_history_tracking(self):
        doc = SharedDocument()
        doc.write_section(day=1, time_slot="morning", agent="food", content="Breakfast")
        doc.consolidate_section(day=1, time_slot="morning", content="Merged", author="facilitator")
        history = doc.history
        assert len(history) == 2
        assert history[0]["action"] == "write"
        assert history[0]["author"] == "food"
        assert history[0]["version"] == 1
        assert history[1]["action"] == "consolidate"
        assert history[1]["author"] == "facilitator"
        assert history[1]["version"] == 2

    def test_multi_day_rendering(self):
        doc = SharedDocument()
        doc.write_section(day=2, time_slot="morning", agent="a", content="Day 2 morning")
        doc.write_section(day=1, time_slot="evening", agent="b", content="Day 1 evening")
        doc.write_section(day=0, time_slot="general", agent="c", content="Overview")
        rendered = doc.render()
        # Day 0 (General) should come first, then Day 1, then Day 2
        general_pos = rendered.index("## General")
        day1_pos = rendered.index("## Day 1")
        day2_pos = rendered.index("## Day 2")
        assert general_pos < day1_pos < day2_pos
        # General slot should not get a ### header
        assert "### General" not in rendered
        # Other slots get ### headers
        assert "### Morning" in rendered
        assert "### Evening" in rendered
