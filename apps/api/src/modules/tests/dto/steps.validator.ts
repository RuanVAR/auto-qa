import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Hard cap on steps per test — guards against absurd payloads / DoS. */
export const MAX_STEPS_PER_TEST = 2000;

/**
 * Lightweight structural validation for a test's `steps` array.
 *
 * Steps are intentionally polymorphic (dozens of step types, each with its
 * own `input` shape), so we don't try to validate every variant here — that
 * belongs in the executor. But the DTO previously accepted ANY array
 * (`steps!: object[]`), so a caller could POST megabytes of arbitrary junk.
 * This enforces the invariants every step must satisfy: it's a plain object
 * with a non-empty string `type`, and the array is bounded.
 */
@ValidatorConstraint({ name: 'isStepArray', async: false })
export class IsStepArrayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    if (value.length > MAX_STEPS_PER_TEST) return false;
    return value.every(
      (s) =>
        s !== null &&
        typeof s === 'object' &&
        !Array.isArray(s) &&
        typeof (s as { type?: unknown }).type === 'string' &&
        ((s as { type: string }).type).length > 0,
    );
  }

  defaultMessage(): string {
    return `steps must be an array (≤${MAX_STEPS_PER_TEST}) of objects, each with a non-empty string "type"`;
  }
}

export function IsStepArray(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStepArray',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsStepArrayConstraint,
    });
  };
}
