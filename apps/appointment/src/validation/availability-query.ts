export type AvailabilityQueryValidationResult =
  | {
      success: true;
      data: {
        businessId: string;
        date: string;
      };
    }
  | {
      success: false;
      errors: string[];
    };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateAvailabilityQuery(
  value: unknown
): AvailabilityQueryValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      errors: ["Availability query must be an object."],
    };
  }

  const query = value as Record<string, unknown>;
  const errors: string[] = [];
  const businessId = readBusinessId(query.businessId, errors);
  const date = readDate(query.date, errors);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      businessId: businessId!,
      date: date!,
    },
  };
}

function readBusinessId(value: unknown, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push("businessId is required.");
    return null;
  }

  return value.trim();
}

function readDate(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null || value === "") {
    errors.push("date is required.");
    return null;
  }

  if (typeof value !== "string" || !DATE_PATTERN.test(value.trim())) {
    errors.push("date must use YYYY-MM-DD format.");
    return null;
  }

  const date = value.trim();
  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year!, month! - 1, day!));

  if (parsedDate.toISOString().slice(0, 10) !== date) {
    errors.push("date must be a valid calendar date.");
    return null;
  }

  return date;
}
