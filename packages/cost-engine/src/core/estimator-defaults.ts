/**
 * Named defaults for the estimate pipeline.
 *
 * These used to be bare literals inside `createEstimate`, where a reader could
 * not tell a billing *convention* (730 hours is how clouds define a month)
 * from an *assumption* about the customer's estate (10 accounts) — and only
 * the second kind changes someone's quote when it is wrong.
 */

/** CONVENTION — the hour count cloud providers bill a "month" as (365x24/12). */
export const DEFAULT_MONTH_HOURS_VALUE = 730;

/** ASSUMPTION — accounts in scope when the caller says nothing. */
export const DEFAULT_ACCOUNT_COUNT = 10;
