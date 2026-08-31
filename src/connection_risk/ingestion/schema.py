"""Data-quality reporting contracts for historical ingestion."""

from pydantic import BaseModel, ConfigDict, Field


class IngestionStatistics(BaseModel):
    model_config = ConfigDict(frozen=True)

    rows_read: int = Field(ge=0)
    rows_valid: int = Field(ge=0)
    rows_rejected: int = Field(ge=0)
    duplicates_removed: int = Field(ge=0)
    rejection_reasons: list[str] = Field(default_factory=list)
    rejection_reason_counts: dict[str, int] = Field(default_factory=dict)
