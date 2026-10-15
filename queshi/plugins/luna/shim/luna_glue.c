/* ============================================================================
 * luna_glue.c - bridge between JS and the unmodified friso MMSEG engine.
 *
 * Exports (wasm):
 *   luna_buf(size) / luna_buf_free(ptr)
 *       raw heap buffers so JS can stage the dict pack and input/output text
 *   luna_load_pack(ptr, len) -> int
 *       parse an LDIC archive and VFS-mount every member:
 *         magic 'LDIC' | u32 count | { u32 nameLen, name bytes,
 *                                      u32 dataLen, data bytes }...
 *   luna_init(ini_name) -> int
 *       init friso from the given already-mounted ini basename (1 = ok)
 *   luna_segment(text_ptr, out_ptr, out_len) -> int
 *       MMSEG-segment UTF-8 text; write tokens joined by 0x1f into out,
 *       nul terminated. Returns bytes written (excl. nul), -1 on overflow.
 * ==========================================================================*/

#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

#include "friso.h"
#include "friso_API.h"

#define LUNA_SEP '\x1f'

static friso_t        g_fr = NULL;
static friso_config_t g_cfg = NULL;
static friso_task_t   g_task = NULL;

unsigned int luna_buf(unsigned int size)
{
    return (unsigned int)(uintptr_t)malloc((size_t)size);
}

void luna_buf_free(unsigned int ptr)
{
    if (ptr) free((void *)(uintptr_t)ptr);
}

static unsigned int rd_u32le(const unsigned char *p)
{
    return (unsigned int)p[0]
         | ((unsigned int)p[1] << 8)
         | ((unsigned int)p[2] << 16)
         | ((unsigned int)p[3] << 24);
}

int luna_load_pack(unsigned int ptr, unsigned int len)
{
    const unsigned char *p = (const unsigned char *)(uintptr_t)ptr;
    const unsigned char *end = p + len;
    unsigned int count, i, mounted = 0;

    if (len < 8 || p[0] != 'L' || p[1] != 'D' || p[2] != 'I' || p[3] != 'C')
        return -1;
    count = rd_u32le(p + 4);
    p += 8;

    for (i = 0; i < count; i++) {
        unsigned int nlen, dlen;
        char *name;
        if (p + 4 > end) return -2;
        nlen = rd_u32le(p);
        p += 4;
        if (p + nlen + 4 > end) return -2;
        name = (char *)malloc((size_t)nlen + 1u);
        if (!name) return -3;
        memcpy(name, p, nlen);
        name[nlen] = 0;
        p += nlen;
        dlen = rd_u32le(p);
        p += 4;
        if (p + dlen > end) { free(name); return -2; }
        luna_vfs_mount(name, p, dlen);
        p += dlen;
        free(name);
        mounted++;
    }
    return (int)mounted;
}

int luna_init(const char *ini_name)
{
    if (g_cfg != NULL) return 1;
    g_fr = friso_new();
    if (g_fr == NULL) return 0;
    g_cfg = friso_new_config();
    if (g_cfg == NULL) return 0;
    if (friso_init_from_ifile(g_fr, g_cfg, (fstring)ini_name) != 1) return 0;
    g_task = friso_new_task();
    if (g_task == NULL) return 0;
    return 1;
}

int luna_cfg_field(unsigned int id)
{
    if (g_fr == NULL || g_cfg == NULL) return -1;
    switch (id) {
    case 0: return (int)g_fr->charset;
    case 1: return (int)g_cfg->mode;
    case 2: return (int)g_cfg->max_len;
    case 3: return (int)g_cfg->keep_urec;
    case 4: return (int)g_cfg->en_sseg;
    default: return -999;
    }
}

unsigned int luna_dic_size(void)
{
    if (g_fr == NULL || g_fr->dic == NULL) return 0;
    return friso_all_dic_size(g_fr->dic);
}

int luna_dic_has(unsigned int word_ptr)
{
    const char *w = (const char *)(uintptr_t)word_ptr;
    if (g_fr == NULL || g_fr->dic == NULL) return -1;
    return friso_dic_match(g_fr->dic, __LEX_CJK_WORDS__, (fstring)w);
}

int luna_segment(unsigned int text_ptr, unsigned int out_ptr, unsigned int out_len)
{
    const char *text = (const char *)(uintptr_t)text_ptr;
    char *out = (char *)(uintptr_t)out_ptr;
    friso_token_t tk;
    unsigned int used = 0;
    int first = 1;

    if (g_cfg == NULL || g_task == NULL || out_len == 0) return -1;

    friso_set_text(g_task, (fstring)text);
    while ((tk = g_cfg->next_token(g_fr, g_cfg, g_task)) != NULL) {
        const char *w = (const char *)tk->word;
        unsigned int wlen = (unsigned int)strlen(w);
        if (!first) {
            if (used + 1 >= out_len) return -1;
            out[used++] = (char)LUNA_SEP;
        }
        if (used + wlen + 1 > out_len) return -1;
        memcpy(out + used, w, wlen);
        used += wlen;
        out[used] = 0;
        first = 0;
    }
    out[used] = 0;
    return (int)used;
}
