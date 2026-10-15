/* Minimal freestanding stdlib shim for friso-on-wasm. */
#ifndef _SHIM_STDLIB_H
#define _SHIM_STDLIB_H

#include <stddef.h>

void *malloc(size_t size);
void *calloc(size_t nmemb, size_t size);
void *realloc(void *ptr, size_t size);
void  free(void *ptr);

int   atoi(const char *s);
long  strtol(const char *s, char **end, int base);
unsigned long strtoul(const char *s, char **end, int base);

void  abort(void) __attribute__((noreturn));
void  exit(int status) __attribute__((noreturn));

#endif /* _SHIM_STDLIB_H */
