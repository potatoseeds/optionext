/* ============================================================================
 * shim.c - freestanding libc subset for running the unmodified friso C
 *          sources under wasm32 (no WASI, no emscripten).
 *
 * Provides:
 *   - K&R first-fit heap over a fixed BSS arena
 *   - string / stdlib subset used by friso
 *   - VFS-backed stdio (fopen by basename, fgetc streaming)
 *   - tiny printf forwarding to the JS import luna_log
 *   - a double-precision natural log (MMSEG frequency scoring)
 * ==========================================================================*/

#include <stdint.h>
#include <stdarg.h>
#include <stddef.h>

#include "stdio.h"
#include "stdlib.h"
#include "string.h"
#include "math.h"

/* ---------------- JS imports ---------------- */
__attribute__((import_module("env"), import_name("luna_log")))
extern void luna_log(const char *msg);
__attribute__((import_module("env"), import_name("luna_panic"), noreturn))
extern void luna_panic(const char *msg);

/* ============================================================
 * Heap: classic K&R first-fit free list over a BSS arena.
 * ============================================================ */
typedef union shim_header {
    struct { union shim_header *ptr; unsigned int size; } s;
    double align_;                                  /* force 8-byte alignment */
} HEADER;

#define ARENA_BYTES (44u * 1024u * 1024u)
static unsigned char g_arena[ARENA_BYTES] __attribute__((aligned(16)));
static unsigned int g_bump = 0;

static HEADER g_base;                             /* free-list sentinel */
static HEADER *g_freep = NULL;

#define NALLOC_UNITS 1024                          /* min chunk: 16 KiB */

static HEADER *morecore(unsigned int nu)
{
    HEADER *up;
    if (nu < NALLOC_UNITS) nu = NALLOC_UNITS;
    {
        unsigned int bytes = nu * (unsigned int)sizeof(HEADER);
        if ((unsigned long)g_bump + bytes > ARENA_BYTES) return NULL;
        up = (HEADER *)(void *)(g_arena + g_bump);
        g_bump += bytes;
    }
    up->s.size = nu;
    free((void *)(up + 1));
    return g_freep;
}

void *malloc(size_t nbytes)
{
    HEADER *p, *prevp;
    unsigned int nunits;

    if (nbytes == 0) return NULL;
    nunits = (unsigned int)((nbytes + sizeof(HEADER) - 1) / sizeof(HEADER)) + 1;

    if ((prevp = g_freep) == NULL) {
        g_base.s.ptr = g_freep = prevp = &g_base;
        g_base.s.size = 0;
    }
    for (p = prevp->s.ptr; ; prevp = p, p = p->s.ptr) {
        if (p->s.size >= nunits) {
            if (p->s.size == nunits) {
                prevp->s.ptr = p->s.ptr;
            } else {
                p->s.size -= nunits;
                p += p->s.size;
                p->s.size = nunits;
            }
            g_freep = prevp;
            return (void *)(p + 1);
        }
        if (p == g_freep) {
            if ((p = morecore(nunits)) == NULL) return NULL;
        }
    }
}

void free(void *ap)
{
    HEADER *bp, *p;
    if (ap == NULL) return;
    bp = (HEADER *)ap - 1;
    for (p = g_freep; !(bp > p && bp < p->s.ptr); p = p->s.ptr) {
        if (p >= p->s.ptr && (bp > p || bp < p->s.ptr)) break;
    }

    if (bp + bp->s.size == p->s.ptr) {
        bp->s.size += p->s.ptr->s.size;
        bp->s.ptr = p->s.ptr->s.ptr;
    } else {
        bp->s.ptr = p->s.ptr;
    }
    if (p + p->s.size == bp) {
        p->s.size += bp->s.size;
        p->s.ptr = bp->s.ptr;
    } else {
        p->s.ptr = bp;
    }
    g_freep = p;
}

void *calloc(size_t nmemb, size_t size)
{
    size_t total = nmemb * size;
    void *p;
    if (size && nmemb > (size_t)-1 / size) return NULL;
    p = malloc(total);
    if (p) memset(p, 0, total);
    return p;
}

void *realloc(void *ptr, size_t size)
{
    HEADER *h;
    void *np;
    size_t old;
    if (ptr == NULL) return malloc(size);
    if (size == 0) { free(ptr); return NULL; }
    h = (HEADER *)ptr - 1;
    old = (size_t)(h->s.size - 1) * sizeof(HEADER);
    if (old >= size) return ptr;
    np = malloc(size);
    if (!np) return NULL;
    memcpy(np, ptr, old);
    free(ptr);
    return np;
}

void exit(int status)            { (void)status; luna_panic("libc exit"); }
void abort(void)                 { luna_panic("libc abort"); }

/* ============================================================
 * string.h subset
 * ============================================================ */
void *memcpy(void *dst, const void *src, size_t n)
{
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    size_t i;
    for (i = 0; i < n; i++) d[i] = s[i];
    return dst;
}

void *memmove(void *dst, const void *src, size_t n)
{
    unsigned char *d = (unsigned char *)dst;
    const unsigned char *s = (const unsigned char *)src;
    if (d == s || n == 0) return dst;
    if (d < s) {
        size_t i;
        for (i = 0; i < n; i++) d[i] = s[i];
    } else {
        while (n) { n--; d[n] = s[n]; }
    }
    return dst;
}

void *memset(void *dst, int c, size_t n)
{
    unsigned char *d = (unsigned char *)dst;
    size_t i;
    for (i = 0; i < n; i++) d[i] = (unsigned char)c;
    return dst;
}

int memcmp(const void *a, const void *b, size_t n)
{
    const unsigned char *x = (const unsigned char *)a;
    const unsigned char *y = (const unsigned char *)b;
    size_t i;
    for (i = 0; i < n; i++) if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
}

size_t strlen(const char *s)
{
    const char *p = s;
    while (*p) p++;
    return (size_t)(p - s);
}

char *strcpy(char *dst, const char *src)
{
    char *r = dst;
    while ((*dst++ = *src++) != 0) {}
    return r;
}

char *strncpy(char *dst, const char *src, size_t n)
{
    size_t i;
    for (i = 0; i < n && src[i]; i++) dst[i] = src[i];
    for (; i < n; i++) dst[i] = 0;
    return dst;
}

char *strcat(char *dst, const char *src)
{
    char *r = dst;
    while (*dst) dst++;
    while ((*dst++ = *src++) != 0) {}
    return r;
}

int strcmp(const char *a, const char *b)
{
    while (*a && *a == *b) { a++; b++; }
    return (int)(unsigned char)*a - (int)(unsigned char)*b;
}

int strncmp(const char *a, const char *b, size_t n)
{
    size_t i;
    for (i = 0; i < n; i++) {
        unsigned char ca = (unsigned char)a[i], cb = (unsigned char)b[i];
        if (ca != cb) return (int)ca - (int)cb;
        if (ca == 0) return 0;
    }
    return 0;
}

char *strchr(const char *s, int c)
{
    for (;; s++) {
        if (*s == (char)c) return (char *)s;
        if (*s == 0) return NULL;
    }
}

char *strrchr(const char *s, int c)
{
    const char *last = NULL;
    for (;; s++) {
        if (*s == (char)c) last = s;
        if (*s == 0) break;
    }
    return (char *)last;
}

char *strstr(const char *a, const char *b)
{
    size_t lb = strlen(b);
    if (lb == 0) return (char *)a;
    for (; *a; a++) {
        if (*a == b[0] && strncmp(a, b, lb) == 0) return (char *)a;
    }
    return NULL;
}

char *strdup(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = (char *)malloc(n);
    if (p) memcpy(p, s, n);
    return p;
}

/* ============================================================
 * stdlib numeric parsing
 * ============================================================ */
long strtol(const char *s, char **end, int base)
{
    long v = 0;
    int neg = 0;
    while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') s++;
    if (*s == '-') { neg = 1; s++; } else if (*s == '+') s++;
    if ((base == 0 || base == 16) && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        s += 2; base = 16;
    } else if (base == 0) {
        base = (*s == '0') ? 8 : 10;
    }
    for (;;) {
        int d;
        char c = *s;
        if (c >= '0' && c <= '9') d = c - '0';
        else if (c >= 'a' && c <= 'z') d = c - 'a' + 10;
        else if (c >= 'A' && c <= 'Z') d = c - 'A' + 10;
        else break;
        if (d >= base) break;
        v = v * base + d;
        s++;
    }
    if (end) *end = (char *)s;
    return neg ? -v : v;
}

unsigned long strtoul(const char *s, char **end, int base)
{
    return (unsigned long)strtol(s, end, base);
}

int atoi(const char *s)
{
    return (int)strtol(s, NULL, 10);
}

/* ============================================================
 * stdio: in-memory VFS
 * ============================================================ */
#define MAX_MOUNTS 64
#define MAX_FILES  24

typedef struct {
    char *name;                       /* nul terminated basename */
    const unsigned char *data;
    unsigned int len;
} Mount;

static Mount g_mounts[MAX_MOUNTS];
static int g_nmount = 0;

static FILE g_stdin_s  = {NULL, 0, 0, 1};
static FILE g_stdout_s = {NULL, 0, 0, 1};
static FILE g_stderr_s = {NULL, 0, 0, 1};
FILE *const stdin  = &g_stdin_s;
FILE *const stdout = &g_stdout_s;
FILE *const stderr = &g_stderr_s;

static FILE g_files[MAX_FILES];

void luna_vfs_mount(const char *name, const unsigned char *data, unsigned int len)
{
    int i;
    for (i = 0; i < g_nmount; i++) {
        if (strcmp(g_mounts[i].name, name) == 0) {
            g_mounts[i].data = data;
            g_mounts[i].len = len;
            return;
        }
    }
    if (g_nmount < MAX_MOUNTS) {
        size_t n = strlen(name) + 1;
        char *nm = (char *)malloc(n);
        if (nm) {
            memcpy(nm, name, n);
            g_mounts[g_nmount].name = nm;
            g_mounts[g_nmount].data = data;
            g_mounts[g_nmount].len = len;
            g_nmount++;
        }
    }
}

static const char *path_basename(const char *p)
{
    const char *b = p;
    for (; *p; p++) {
        if (*p == '/' || *p == '\\') b = p + 1;
    }
    return b;
}

FILE *fopen(const char *path, const char *mode)
{
    const char *bn;
    int i, slot = -1;
    (void)mode;
    if (!path) return NULL;
    bn = path_basename(path);
    for (i = 0; i < MAX_FILES; i++) {
        if (!g_files[i].used) { slot = i; break; }
    }
    if (slot < 0) return NULL;
    for (i = 0; i < g_nmount; i++) {
        if (strcmp(g_mounts[i].name, bn) == 0) {
            g_files[slot].data = g_mounts[i].data;
            g_files[slot].len = g_mounts[i].len;
            g_files[slot].pos = 0;
            g_files[slot].used = 1;
            return &g_files[slot];
        }
    }
    return NULL;
}

int fclose(FILE *f)
{
    if (f && f != stdin && f != stdout && f != stderr) f->used = 0;
    return 0;
}

int fgetc(FILE *f)
{
    if (!f || f->pos >= f->len) return EOF;
    return (int)f->data[f->pos++];
}

int ungetc(int c, FILE *f)
{
    if (!f || c == EOF || f->pos == 0) return EOF;
    f->pos--;
    (void)c;
    return c;
}

char *fgets(char *s, int n, FILE *f)
{
    int i = 0;
    if (n <= 0) return NULL;
    while (i < n - 1) {
        int c = fgetc(f);
        if (c == EOF) break;
        s[i++] = (char)c;
        if (c == '\n') break;
    }
    if (i == 0) return NULL;
    s[i] = 0;
    return s;
}

int fputc(int c, FILE *f)
{
    (void)f;
    return c;                                   /* output is a no-op here */
}

int fputs(const char *s, FILE *f)
{
    (void)f; (void)s;
    return (int)strlen(s);
}

/* ---------------- tiny printf: %s %d %i %u %x %c %% ---------------- */
static int emit_num(char *b, unsigned long v, int base, int neg)
{
    char tmp[24];
    int n = 0, i;
    const char *digits = "0123456789abcdef";
    if (v == 0) tmp[n++] = '0';
    while (v) { tmp[n++] = digits[v % (unsigned long)base]; v /= (unsigned long)base; }
    i = 0;
    if (neg) b[i++] = '-';
    while (n) b[i++] = tmp[--n];
    return i;
}

int vfprintf(FILE *f, const char *fmt, va_list ap)
{
    char buf[2048];
    int n = 0;
    (void)f;
    while (*fmt && n < (int)sizeof(buf) - 24) {
        if (*fmt != '%') { buf[n++] = *fmt++; continue; }
        fmt++;
        if (*fmt == '%') { buf[n++] = '%'; fmt++; continue; }
        /* width (ignored beyond simple zero handling) */
        while (*fmt >= '0' && *fmt <= '9') fmt++;
        switch (*fmt) {
        case 's': {
            const char *s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            while (*s && n < (int)sizeof(buf) - 2) buf[n++] = *s++;
            fmt++;
            break;
        }
        case 'd': case 'i': {
            long v = va_arg(ap, int);
            int neg = v < 0;
            n += emit_num(buf + n, neg ? (unsigned long)(-v) : (unsigned long)v, 10, neg);
            fmt++;
            break;
        }
        case 'u': {
            unsigned long v = va_arg(ap, unsigned int);
            n += emit_num(buf + n, v, 10, 0);
            fmt++;
            break;
        }
        case 'x': case 'X': {
            unsigned long v = va_arg(ap, unsigned int);
            n += emit_num(buf + n, v, 16, 0);
            fmt++;
            break;
        }
        case 'c':
            buf[n++] = (char)va_arg(ap, int);
            fmt++;
            break;
        case 0:
            goto done;
        default:
            buf[n++] = '%';
            buf[n++] = *fmt++;
            break;
        }
    }
done:
    buf[n] = 0;
    luna_log(buf);
    return n;
}

int vprintf(const char *fmt, va_list ap)
{
    return vfprintf(stdout, fmt, ap);
}

int printf(const char *fmt, ...)
{
    va_list ap;
    int r;
    va_start(ap, fmt);
    r = vfprintf(stdout, fmt, ap);
    va_end(ap);
    return r;
}

int fprintf(FILE *f, const char *fmt, ...)
{
    va_list ap;
    int r;
    va_start(ap, fmt);
    r = vfprintf(f, fmt, ap);
    va_end(ap);
    return r;
}

int putchar(int c)
{
    char s[2];
    s[0] = (char)c;
    s[1] = 0;
    luna_log(s);
    return c;
}

int puts(const char *s)
{
    luna_log(s);
    return (int)strlen(s) + 1;
}

/* ============================================================
 * math: natural log via atanh series, double precision.
 *   x = 2^e * m, m in [1,2); y=(m-1)/(m+1) in [0,1/3]
 *   ln(m) = 2*(y + y^3/3 + y^5/5 + ...)
 * Used by friso MMSEG scoring as (float)log((float)fre); error
 * < 1e-24 keeps the float cast identical to libm for integer freqs.
 * ============================================================ */
double log(double x)
{
    union { double d; uint64_t u; } v;
    int e;
    double y, y2, term, sum;
    int k;

    if (x != x) return x;                         /* NaN */
    if (x < 0.0) return 0.0 / 0.0;                /* NaN */
    if (x == 0.0) {
        v.u = 0xfff0000000000000ULL;              /* -infinity */
        return v.d;
    }
    v.d = x;
    if ((v.u >> 52) == 0x7ff) return x;           /* +-inf already guarded */
    e = (int)(v.u >> 52) - 1023;
    if ((v.u >> 52) == 0) {
        /* subnormal: scale into normal range */
        v.d = x * 9007199254740992.0;             /* 2^53 */
        e = (int)(v.u >> 52) - 1023 - 53;
    }
    v.u = (v.u & 0x000fffffffffffffULL) | 0x3ff0000000000000ULL;
    y = (v.d - 1.0) / (v.d + 1.0);
    y2 = y * y;
    term = y;
    sum = y;
    for (k = 1; k < 24; k++) {
        term *= y2;
        sum += term / (double)(2 * k + 1);
    }
    return 2.0 * sum + (double)e * 0.69314718055994530942;
}

float logf(float x)
{
    return (float)log((double)x);
}
