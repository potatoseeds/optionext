/* Minimal freestanding stdio shim for friso-on-wasm.
 * Only the surface used by the friso sources is provided. */
#ifndef _SHIM_STDIO_H
#define _SHIM_STDIO_H

#include <stddef.h>
#include <stdarg.h>

#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2

typedef struct _shim_FILE {
    const unsigned char *data;
    unsigned int pos;
    unsigned int len;
    int used;
} FILE;

extern FILE *const stdin;
extern FILE *const stdout;
extern FILE *const stderr;

FILE *fopen(const char *path, const char *mode);
int   fclose(FILE *f);
int   fgetc(FILE *f);
int   ungetc(int c, FILE *f);
char *fgets(char *s, int n, FILE *f);

int printf(const char *fmt, ...);
int fprintf(FILE *f, const char *fmt, ...);
int vprintf(const char *fmt, va_list ap);
int vfprintf(FILE *f, const char *fmt, va_list ap);
int putchar(int c);
int fputc(int c, FILE *f);
int fputs(const char *s, FILE *f);
int puts(const char *s);

/* VFS used by fopen: mount a file blob under its basename. */
void luna_vfs_mount(const char *name, const unsigned char *data, unsigned int len);

#endif /* _SHIM_STDIO_H */
