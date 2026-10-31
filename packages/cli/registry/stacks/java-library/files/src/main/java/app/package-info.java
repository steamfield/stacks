/**
 * Parse and validate slugs.
 *
 * <p>{@link app.Slug#parse(CharSequence)} checks input against the default {@link app.SlugRules};
 * {@link app.SlugRules#withMaxLength(int)} builds stricter or looser rules. Every failure is a
 * {@link app.SlugException} whose {@link app.SlugException#error()} is one of the {@link
 * app.SlugError} records, so callers handle each kind with a {@code switch} instead of reading the
 * message.
 *
 * <p>Types are non-null unless marked {@code @Nullable}.
 */
@NullMarked
package app;

import org.jspecify.annotations.NullMarked;
