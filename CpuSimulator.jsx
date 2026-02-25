import { useState, useEffect, useRef, useCallback } from 'react';

// ═══════════ HELPERS ═══════════
const hex2 = n => (n & 0xFF).toString(16).padStart(2, '0').toUpperCase();
const bin8 = n => (n & 0xFF).toString(2).padStart(8, '0');
const FONT = '"JetBrains Mono","Courier New",monospace';
const C = { bg: '#030303', accent: '#00ff88', cyan: '#00ccff', warn: '#ff9900', danger: '#ff4444', purple: '#cc44ff', pink: '#ff4488', teal: '#44ffcc' };
const glow = (active, color) => active ? { boxShadow: `0 0 12px ${color}, 0 0 24px ${color}44`, border: `1px solid ${color}` } : {};

// ═══════════ OPCODES ═══════════
const OP = { LOADI: 0x01, LOAD: 0x02, STORE: 0x03, ADD: 0x10, SUB: 0x11, INC: 0x12, DEC: 0x13, AND: 0x20, OR: 0x21, XOR: 0x22, NOT: 0x23, SHL: 0x30, SHR: 0x31, JMP: 0x40, JZ: 0x41, JNZ: 0x42, PUSH: 0x50, POP: 0x51, CALL: 0x52, RET: 0x53, HALT: 0xFF };
const ROPS = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));

// ═══════════ CPU ENGINE ═══════════
const createCPU = () => ({ memory: new Array(256).fill(0), regs: new Array(8).fill(0), pc: 0, sp: 0xFF, ir: 0, mar: 0, mdr: 0, flags: { Z: false, C: false, N: false, V: false }, halted: false, clock: 0, microOp: '', lastAccess: { type: null, addr: null, reg: null, bus: 'idle' }, phase: 'FETCH' });

function cpuStep(prev) {
    const s = { ...prev, memory: [...prev.memory], regs: [...prev.regs], flags: { ...prev.flags }, lastAccess: { type: null, addr: null, reg: null, bus: 'idle' } };
    if (s.halted) { s.microOp = 'HALTED'; return s; }
    // FETCH
    s.mar = s.pc & 0xFF; s.mdr = s.memory[s.mar]; s.ir = s.mdr; s.pc = (s.pc + 1) & 0xFF;
    s.lastAccess = { type: 'read', addr: s.mar, reg: null, bus: 'address' };
    s.phase = 'EXECUTE';
    const rb = () => { const v = s.memory[s.pc & 0xFF]; s.pc = (s.pc + 1) & 0xFF; return v; };
    const setFlags = (r, carry = false, overflow = false) => { s.flags.Z = (r & 0xFF) === 0; s.flags.N = !!(r & 0x80); s.flags.C = carry; s.flags.V = overflow; };

    switch (s.ir) {
        case OP.LOADI: { const rn = rb(), imm = rb(); s.regs[rn & 7] = imm & 0xFF; s.lastAccess = { type: 'write', addr: null, reg: rn & 7, bus: 'data' }; s.microOp = `LOADI R${rn & 7}, #${imm}`; break; }
        case OP.LOAD: { const rn = rb(), addr = rb(); s.mar = addr & 0xFF; s.mdr = s.memory[s.mar]; s.regs[rn & 7] = s.mdr; s.lastAccess = { type: 'read', addr: s.mar, reg: rn & 7, bus: 'data' }; s.microOp = `LOAD R${rn & 7}, [0x${hex2(addr)}]`; break; }
        case OP.STORE: { const rn = rb(), addr = rb(); s.mar = addr & 0xFF; s.mdr = s.regs[rn & 7]; s.memory[s.mar] = s.mdr; s.lastAccess = { type: 'write', addr: s.mar, reg: rn & 7, bus: 'data' }; s.microOp = `STORE R${rn & 7}, [0x${hex2(addr)}]`; break; }
        case OP.ADD: { const rd = rb() & 7, rs = rb() & 7; const sum = s.regs[rd] + s.regs[rs]; const carry = sum > 255; const ov = !!((~(s.regs[rd] ^ s.regs[rs]) & (s.regs[rd] ^ sum)) & 0x80); s.regs[rd] = sum & 0xFF; setFlags(s.regs[rd], carry, ov); s.lastAccess = { type: 'write', addr: null, reg: rd, bus: 'data' }; s.microOp = `ADD R${rd}, R${rs} = ${s.regs[rd]}`; break; }
        case OP.SUB: { const rd = rb() & 7, rs = rb() & 7; const diff = s.regs[rd] - s.regs[rs]; const carry = diff < 0; const ov = !!(((s.regs[rd] ^ s.regs[rs]) & (s.regs[rd] ^ diff)) & 0x80); s.regs[rd] = diff & 0xFF; setFlags(s.regs[rd], carry, ov); s.lastAccess = { type: 'write', addr: null, reg: rd, bus: 'data' }; s.microOp = `SUB R${rd}, R${rs} = ${s.regs[rd]}`; break; }
        case OP.INC: { const rn = rb() & 7; const r = (s.regs[rn] + 1) & 0xFF; setFlags(r, s.regs[rn] === 0xFF); s.regs[rn] = r; s.lastAccess = { type: 'write', addr: null, reg: rn, bus: 'data' }; s.microOp = `INC R${rn} = ${r}`; break; }
        case OP.DEC: { const rn = rb() & 7; const r = (s.regs[rn] - 1) & 0xFF; setFlags(r, s.regs[rn] === 0); s.regs[rn] = r; s.lastAccess = { type: 'write', addr: null, reg: rn, bus: 'data' }; s.microOp = `DEC R${rn} = ${r}`; break; }
        case OP.AND: { const rd = rb() & 7, rs = rb() & 7; s.regs[rd] = (s.regs[rd] & s.regs[rs]) & 0xFF; setFlags(s.regs[rd]); s.lastAccess = { type: 'write', addr: null, reg: rd, bus: 'data' }; s.microOp = `AND R${rd}, R${rs} = ${s.regs[rd]}`; break; }
        case OP.OR: { const rd = rb() & 7, rs = rb() & 7; s.regs[rd] = (s.regs[rd] | s.regs[rs]) & 0xFF; setFlags(s.regs[rd]); s.lastAccess = { type: 'write', addr: null, reg: rd, bus: 'data' }; s.microOp = `OR R${rd}, R${rs} = ${s.regs[rd]}`; break; }
        case OP.XOR: { const rd = rb() & 7, rs = rb() & 7; s.regs[rd] = (s.regs[rd] ^ s.regs[rs]) & 0xFF; setFlags(s.regs[rd]); s.lastAccess = { type: 'write', addr: null, reg: rd, bus: 'data' }; s.microOp = `XOR R${rd}, R${rs} = ${s.regs[rd]}`; break; }
        case OP.NOT: { const rn = rb() & 7; s.regs[rn] = (~s.regs[rn]) & 0xFF; setFlags(s.regs[rn]); s.lastAccess = { type: 'write', addr: null, reg: rn, bus: 'data' }; s.microOp = `NOT R${rn} = ${s.regs[rn]}`; break; }
        case OP.SHL: { const rn = rb() & 7; const carry = !!(s.regs[rn] & 0x80); s.regs[rn] = (s.regs[rn] << 1) & 0xFF; setFlags(s.regs[rn], carry); s.lastAccess = { type: 'write', addr: null, reg: rn, bus: 'data' }; s.microOp = `SHL R${rn} = ${s.regs[rn]}`; break; }
        case OP.SHR: { const rn = rb() & 7; const carry = !!(s.regs[rn] & 1); s.regs[rn] = (s.regs[rn] >> 1) & 0xFF; setFlags(s.regs[rn], carry); s.lastAccess = { type: 'write', addr: null, reg: rn, bus: 'data' }; s.microOp = `SHR R${rn} = ${s.regs[rn]}`; break; }
        case OP.JMP: { const addr = rb(); s.pc = addr & 0xFF; s.microOp = `JMP 0x${hex2(addr)}`; break; }
        case OP.JZ: { const addr = rb(); if (s.flags.Z) s.pc = addr & 0xFF; s.microOp = `JZ 0x${hex2(addr)} ${s.flags.Z ? '(taken)' : '(not taken)'}`; break; }
        case OP.JNZ: { const addr = rb(); if (!s.flags.Z) s.pc = addr & 0xFF; s.microOp = `JNZ 0x${hex2(addr)} ${!s.flags.Z ? '(taken)' : '(not taken)'}`; break; }
        case OP.PUSH: { const rn = rb() & 7; s.memory[s.sp] = s.regs[rn]; s.sp = (s.sp - 1) & 0xFF; s.lastAccess = { type: 'write', addr: (s.sp + 1) & 0xFF, reg: rn, bus: 'data' }; s.microOp = `PUSH R${rn} (${s.regs[rn]})`; break; }
        case OP.POP: { const rn = rb() & 7; s.sp = (s.sp + 1) & 0xFF; s.regs[rn] = s.memory[s.sp]; s.lastAccess = { type: 'read', addr: s.sp, reg: rn, bus: 'data' }; s.microOp = `POP R${rn} = ${s.regs[rn]}`; break; }
        case OP.CALL: { const addr = rb(); s.memory[s.sp] = s.pc & 0xFF; s.sp = (s.sp - 1) & 0xFF; s.pc = addr & 0xFF; s.lastAccess = { type: 'write', addr: (s.sp + 1) & 0xFF, reg: null, bus: 'data' }; s.microOp = `CALL 0x${hex2(addr)}`; break; }
        case OP.RET: { s.sp = (s.sp + 1) & 0xFF; s.pc = s.memory[s.sp]; s.lastAccess = { type: 'read', addr: s.sp, reg: null, bus: 'data' }; s.microOp = `RET → 0x${hex2(s.pc)}`; break; }
        case OP.HALT: { s.halted = true; s.microOp = 'HALT'; break; }
        default: s.microOp = `UNKNOWN 0x${hex2(s.ir)}`; break;
    }
    s.clock++; return s;
}

// ═══════════ ASSEMBLER ═══════════
function assemble(src) {
    const lines = src.split('\n'); const errors = []; const labels = {}; let addr = 0;
    const parseReg = t => { const m = t.match(/^[Rr](\d)$/); return m ? parseInt(m[1]) : -1; };
    const parseVal = (t, lbls) => { if (lbls && t in lbls) return lbls[t]; const n = parseInt(t); return isNaN(n) ? -1 : n; };
    const cleaned = lines.map(l => l.replace(/;.*/, '').trim()).filter(l => l);
    // Pass 1: labels
    addr = 0;
    for (const l of cleaned) {
        if (l.endsWith(':')) { labels[l.slice(0, -1)] = addr; continue; }
        const parts = l.replace(/,/g, ' ').split(/\s+/); const mn = parts[0].toUpperCase();
        if (mn === 'RET' || mn === 'HALT') addr += 1;
        else if (['INC', 'DEC', 'NOT', 'SHL', 'SHR', 'PUSH', 'POP'].includes(mn)) addr += 2;
        else if (['JMP', 'JZ', 'JNZ', 'CALL'].includes(mn)) addr += 2;
        else if (['LOADI', 'LOAD', 'STORE', 'ADD', 'SUB', 'AND', 'OR', 'XOR'].includes(mn)) addr += 3;
        else errors.push(`Unknown: ${mn}`);
    }
    // Pass 2: emit
    const bytes = []; const lineMap = []; let lineNum = 0;
    for (const l of cleaned) {
        if (l.endsWith(':')) { lineNum++; continue; }
        const parts = l.replace(/,/g, ' ').split(/\s+/); const mn = parts[0].toUpperCase();
        const p1 = parts[1] || '', p2 = parts[2] || '';
        const start = bytes.length;
        const rn = parseReg(p1), rn2 = parseReg(p2);
        const val = t => parseVal(t.replace(/[\[\]#]/g, ''), labels);
        switch (mn) {
            case 'LOADI': bytes.push(OP.LOADI, rn, val(p2) & 0xFF); break;
            case 'LOAD': bytes.push(OP.LOAD, rn, val(p2) & 0xFF); break;
            case 'STORE': bytes.push(OP.STORE, rn, val(p2) & 0xFF); break;
            case 'ADD': bytes.push(OP.ADD, rn, rn2); break;
            case 'SUB': bytes.push(OP.SUB, rn, rn2); break;
            case 'INC': bytes.push(OP.INC, rn); break;
            case 'DEC': bytes.push(OP.DEC, rn); break;
            case 'AND': bytes.push(OP.AND, rn, rn2); break;
            case 'OR': bytes.push(OP.OR, rn, rn2); break;
            case 'XOR': bytes.push(OP.XOR, rn, rn2); break;
            case 'NOT': bytes.push(OP.NOT, rn); break;
            case 'SHL': bytes.push(OP.SHL, rn); break;
            case 'SHR': bytes.push(OP.SHR, rn); break;
            case 'JMP': bytes.push(OP.JMP, val(p1) & 0xFF); break;
            case 'JZ': bytes.push(OP.JZ, val(p1) & 0xFF); break;
            case 'JNZ': bytes.push(OP.JNZ, val(p1) & 0xFF); break;
            case 'PUSH': bytes.push(OP.PUSH, rn); break;
            case 'POP': bytes.push(OP.POP, rn); break;
            case 'CALL': bytes.push(OP.CALL, val(p1) & 0xFF); break;
            case 'RET': bytes.push(OP.RET); break;
            case 'HALT': bytes.push(OP.HALT); break;
            default: if (!errors.find(e => e.includes(mn))) errors.push(`Unknown: ${mn}`);
        }
        for (let i = start; i < bytes.length; i++) lineMap.push(lineNum);
        lineNum++;
    }
    return { bytes, errors, lineMap };
}

// ═══════════ EXAMPLES ═══════════
const EXAMPLE_PROGRAMS = {
    "Counter Loop": `; Count from 0 to 5\nLOADI R0, #0\nLOADI R1, #5\nLOOP:\nINC R0\nSUB R1, R0\nJNZ LOOP\nHALT`,
    "Fibonacci": `; Fibonacci sequence\nLOADI R0, #0\nLOADI R1, #1\nLOADI R3, #7\nLOOP:\nLOADI R2, #0\nADD R2, R0\nADD R2, R1\nLOADI R0, #0\nADD R0, R1\nLOADI R1, #0\nADD R1, R2\nDEC R3\nJNZ LOOP\nHALT`,
    "Bitwise Demo": `; Bitwise operations\nLOADI R0, #170\nLOADI R1, #204\nLOADI R2, #170\nAND R2, R1\nLOADI R3, #170\nOR R3, R1\nLOADI R4, #170\nXOR R4, R1\nHALT`,
    "Stack Demo": `; Stack push/pop\nLOADI R0, #10\nLOADI R1, #20\nLOADI R2, #30\nPUSH R0\nPUSH R1\nPUSH R2\nPOP R5\nPOP R6\nPOP R7\nHALT`,
    "Memory R/W": `; Memory read/write\nLOADI R0, #42\nSTORE R0, [200]\nLOADI R0, #0\nLOAD R0, [200]\nINC R0\nSTORE R0, [200]\nHALT`
};

// ═══════════ INSTRUCTION REFERENCE ═══════════
const INSTR_REF = [
    ['LOADI Rn, #imm', '01 rn imm', 'Load immediate value into register'],
    ['LOAD Rn, [addr]', '02 rn addr', 'Load from memory address into register'],
    ['STORE Rn, [addr]', '03 rn addr', 'Store register value to memory address'],
    ['ADD Rd, Rs', '10 rd rs', 'Add Rs to Rd, result in Rd'],
    ['SUB Rd, Rs', '11 rd rs', 'Subtract Rs from Rd, result in Rd'],
    ['INC Rn', '12 rn', 'Increment register by 1'],
    ['DEC Rn', '13 rn', 'Decrement register by 1'],
    ['AND Rd, Rs', '20 rd rs', 'Bitwise AND'], ['OR Rd, Rs', '21 rd rs', 'Bitwise OR'],
    ['XOR Rd, Rs', '22 rd rs', 'Bitwise XOR'], ['NOT Rn', '23 rn', 'Bitwise NOT'],
    ['SHL Rn', '30 rn', 'Shift left 1 bit'], ['SHR Rn', '31 rn', 'Shift right 1 bit'],
    ['JMP addr', '40 addr', 'Unconditional jump'], ['JZ addr', '41 addr', 'Jump if Zero flag set'],
    ['JNZ addr', '42 addr', 'Jump if Zero flag not set'],
    ['PUSH Rn', '50 rn', 'Push register to stack'], ['POP Rn', '51 rn', 'Pop stack to register'],
    ['CALL addr', '52 addr', 'Call subroutine'], ['RET', '53', 'Return from subroutine'],
    ['HALT', 'FF', 'Stop execution'],
];

// ═══════════ COMPONENT STYLES ═══════════
const card = { background: '#080808', border: '1px solid #1a1a1a', borderRadius: 10, padding: 14 };
const secHdr = (text, color = C.accent) => ({ color, fontFamily: FONT, fontSize: 12, fontWeight: 700, marginBottom: 8, letterSpacing: 1 });

// ═══════════ REGISTER PANEL ═══════════
function RegisterPanel({ regs, lastAccess, flags, pc, sp, ir, mar, mdr }) {
    const specials = [['PC', pc, C.cyan], ['SP', sp, C.warn], ['IR', ir, C.purple], ['MAR', mar, C.pink], ['MDR', mdr, C.teal]];
    return (
        <div>
            <div style={secHdr()}>▸ Register File</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {regs.map((v, i) => {
                    const active = lastAccess.reg === i;
                    return (<div key={i} style={{ background: active ? '#00ff8820' : '#0a0a0a', border: `1px solid ${active ? C.accent : '#333'}`, borderRadius: 6, padding: '4px 6px', fontFamily: FONT, fontSize: 10, transition: 'all 0.3s', ...(active ? { boxShadow: `0 0 12px ${C.accent}, 0 0 24px ${C.accent}44` } : {}) }}>
                        <span style={{ color: C.accent, fontWeight: 700 }}>R{i}</span>
                        <span style={{ color: '#aaa', float: 'right' }}>{v}</span>
                        <div style={{ color: '#555', fontSize: 9 }}>{bin8(v)}</div>
                    </div>);
                })}
            </div>
            <div style={{ ...secHdr(), marginTop: 10 }}>▸ CPU Registers</div>
            {specials.map(([n, v, c]) => (
                <div key={n} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 6px', marginBottom: 2, background: '#0a0a0a', borderRadius: 4, border: '1px solid #222', fontFamily: FONT, fontSize: 10 }}>
                    <span style={{ color: c, fontWeight: 700 }}>{n}</span>
                    <span style={{ color: '#aaa' }}>0x{hex2(v)}</span>
                    <span style={{ color: '#555', fontSize: 9 }}>{bin8(v)}</span>
                </div>
            ))}
            <div style={{ ...secHdr(), marginTop: 10 }}>▸ Status Flags</div>
            <div style={{ display: 'flex', gap: 4 }}>
                {['Z', 'C', 'N', 'V'].map(f => {
                    const on = flags[f];
                    return (<div key={f} style={{ flex: 1, textAlign: 'center', padding: '4px 0', background: on ? '#00ff8820' : '#0a0a0a', border: `1px solid ${on ? C.accent : '#333'}`, borderRadius: 4, fontFamily: FONT, fontSize: 10, transition: 'all 0.3s', ...(on ? { boxShadow: `0 0 12px ${C.accent}` } : {}) }}>
                        <div style={{ color: on ? C.accent : '#555', fontWeight: 700 }}>{f}</div>
                        <div style={{ color: on ? '#fff' : '#333', fontSize: 11 }}>{on ? '1' : '0'}</div>
                    </div>);
                })}
            </div>
        </div>
    );
}

// ═══════════ MEMORY GRID ═══════════
function MemoryGrid({ memory, pc, lastAccess, sp }) {
    const [hov, setHov] = useState(-1);
    return (
        <div>
            <div style={secHdr()}>▸ Memory (256 × 8-bit)</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontFamily: FONT, fontSize: 9 }}>
                <span><span style={{ color: C.cyan }}>■</span> PC</span>
                <span><span style={{ color: C.accent }}>■</span> Access</span>
                <span><span style={{ color: C.warn }}>■</span> SP</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 1, maxHeight: 320, overflowY: 'auto' }}>
                {memory.map((v, i) => {
                    const isPC = i === pc, isAcc = i === lastAccess.addr, isSP = i === sp, isHov = i === hov;
                    let bg = '#0a0a0a', bc = '#1a1a1a', fc = v ? '#666' : '#333';
                    if (isPC) { bg = '#00ccff20'; bc = C.cyan; fc = C.cyan; }
                    if (isAcc) { bg = '#00ff8820'; bc = C.accent; fc = C.accent; }
                    if (isSP) { bg = '#ff990020'; bc = C.warn; fc = C.warn; }
                    if (isHov) { bg = '#ffffff15'; fc = '#fff'; }
                    return (<div key={i} title={`[0x${hex2(i)}] = 0x${hex2(v)} (${v})`} style={{ background: bg, border: `1px solid ${bc}`, borderRadius: 2, padding: '1px 0', textAlign: 'center', fontFamily: FONT, fontSize: 8, color: fc, cursor: 'default', transition: 'all 0.2s', lineHeight: '14px' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(-1)}>
                        {hex2(v)}
                    </div>);
                })}
            </div>
        </div>
    );
}

// ═══════════ ASSEMBLY EDITOR ═══════════
function AssemblyEditor({ onLoad, onExport }) {
    const [src, setSrc] = useState(EXAMPLE_PROGRAMS["Counter Loop"]);
    const [errs, setErrs] = useState([]);
    const [active, setActive] = useState("Counter Loop");
    const [hovBtn, setHovBtn] = useState(null);
    return (
        <div>
            <div style={secHdr()}>▸ Assembly Editor</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {Object.keys(EXAMPLE_PROGRAMS).map(k => (
                    <button key={k} style={{ background: active === k ? '#00ff8830' : '#111', border: `1px solid ${active === k ? C.accent : '#333'}`, color: active === k ? C.accent : '#666', borderRadius: 4, padding: '3px 7px', cursor: 'pointer', fontFamily: FONT, fontSize: 9, transition: 'all 0.2s' }} onClick={() => { setSrc(EXAMPLE_PROGRAMS[k]); setActive(k); setErrs([]); }}>{k}</button>
                ))}
            </div>
            <textarea value={src} onChange={e => { setSrc(e.target.value); setActive(''); }} style={{ width: '100%', height: 220, background: '#050505', color: '#ccc', border: '1px solid #222', borderRadius: 6, padding: 12, fontFamily: FONT, fontSize: 12, lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            {errs.length > 0 && <div style={{ background: '#ff000015', border: '1px solid #ff4444', borderRadius: 4, padding: 6, marginTop: 4, fontFamily: FONT, fontSize: 10, color: C.danger }}>{errs.map((e, i) => <div key={i}>{e}</div>)}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button style={{ flex: 1, padding: '8px 0', background: hovBtn === 'asm' ? '#00ff8825' : '#0a0a0a', border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 6, cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 700, transition: 'all 0.2s' }} onMouseEnter={() => setHovBtn('asm')} onMouseLeave={() => setHovBtn(null)} onClick={() => { const r = assemble(src); setErrs(r.errors); if (!r.errors.length) onLoad(r.bytes); }}>▶ ASSEMBLE &amp; LOAD</button>
                <button style={{ padding: '8px 12px', background: hovBtn === 'exp' ? '#1a1a1a' : '#0a0a0a', border: '1px solid #333', color: '#666', borderRadius: 6, cursor: 'pointer', fontFamily: FONT, fontSize: 11, transition: 'all 0.2s' }} onMouseEnter={() => setHovBtn('exp')} onMouseLeave={() => setHovBtn(null)} onClick={() => onExport(src)}>EXPORT</button>
            </div>
        </div>
    );
}

// ═══════════ CPU DIAGRAM ═══════════
function CPUDiagram({ cpu }) {
    const { pc, sp, ir, mar, mdr, regs, flags, lastAccess, memory, halted, clock } = cpu;
    const mnem = ROPS[ir] || '???';
    const memSlice = [];
    for (let i = -2; i < 10; i++) { const a = (pc + i) & 0xFF; memSlice.push({ addr: a, val: memory[a] }); }
    const box = (x, y, w, h, label, val, sub, color, active) => (
        <g key={label}>
            <rect x={x} y={y} width={w} height={h} rx={4} fill={active ? `${color}15` : '#0a0a0a'} stroke={active ? color : '#333'} strokeWidth={active ? 1.5 : 0.8} style={{ transition: 'all 0.3s' }} />
            <text x={x + w / 2} y={y + 14} textAnchor="middle" fill={color} fontSize={8} fontFamily={FONT} fontWeight="700">{label}</text>
            <text x={x + w / 2} y={y + 28} textAnchor="middle" fill="#ccc" fontSize={11} fontFamily={FONT} fontWeight="700">{val}</text>
            {sub && <text x={x + w / 2} y={y + 42} textAnchor="middle" fill="#555" fontSize={8} fontFamily={FONT}>{sub}</text>}
        </g>
    );
    return (
        <svg viewBox="0 0 700 400" style={{ width: '100%', background: '#060606', borderRadius: 10 }}>
            <defs><marker id="arr" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill="#555" /></marker></defs>
            <text x={350} y={18} textAnchor="middle" fill="#00ff8844" fontSize={10} fontFamily={FONT} fontWeight="700" letterSpacing={3}>VON NEUMANN 8-BIT CPU</text>
            {/* PC */}
            {box(30, 35, 110, 52, 'PROGRAM COUNTER', `0x${hex2(pc)}`, `Dec: ${pc}`, C.cyan, true)}
            {/* Arrow PC→MAR */}
            <line x1={140} y1={61} x2={195} y2={61} stroke={C.cyan} strokeWidth={1} opacity={0.7} markerEnd="url(#arr)" />
            {/* MAR */}
            {box(200, 35, 90, 52, 'MAR', `0x${hex2(mar)}`, `Dec: ${mar}`, C.pink, lastAccess.addr !== null)}
            {/* Arrow MAR→Memory */}
            <line x1={290} y1={61} x2={335} y2={61} stroke={C.pink} strokeWidth={1} opacity={0.7} markerEnd="url(#arr)" />
            {/* Memory block */}
            <rect x={340} y={30} width={120} height={290} rx={4} fill="#0a0a0a" stroke="#333" strokeWidth={0.8} />
            <text x={400} y={46} textAnchor="middle" fill="#666" fontSize={8} fontFamily={FONT} fontWeight="700">MEMORY</text>
            {memSlice.map((m, idx) => {
                const yy = 52 + idx * 22; const isPC = m.addr === pc; const isAcc = m.addr === lastAccess.addr;
                return (<g key={idx}>
                    <rect x={344} y={yy} width={112} height={18} rx={2} fill={isPC ? '#00ccff15' : isAcc ? '#00ff8815' : 'transparent'} />
                    <text x={350} y={yy + 13} fill={isPC ? C.cyan : isAcc ? C.accent : '#555'} fontSize={8} fontFamily={FONT}>{hex2(m.addr)}</text>
                    <text x={380} y={yy + 13} fill={isPC ? C.cyan : isAcc ? C.accent : '#777'} fontSize={9} fontFamily={FONT} fontWeight="700">{hex2(m.val)}</text>
                    <text x={410} y={yy + 13} fill="#444" fontSize={7} fontFamily={FONT}>{ROPS[m.val] || ''}</text>
                </g>);
            })}
            {/* Arrow Memory→MDR */}
            <line x1={340} y1={140} x2={295} y2={140} stroke={C.teal} strokeWidth={1} opacity={0.7} markerEnd="url(#arr)" />
            {/* MDR */}
            {box(200, 110, 90, 52, 'MDR', `0x${hex2(mdr)}`, `Dec: ${mdr}`, C.teal, lastAccess.bus === 'data')}
            {/* Arrow MDR→IR */}
            <line x1={200} y1={136} x2={145} y2={136} stroke={C.purple} strokeWidth={1} opacity={0.7} markerEnd="url(#arr)" />
            {/* IR */}
            {box(30, 110, 110, 52, 'INSTR REG', `0x${hex2(ir)}`, mnem, C.purple, true)}
            {/* Control Unit */}
            <rect x={30} y={195} width={200} height={70} rx={4} fill={halted ? '#ff000010' : '#00ff8808'} stroke={halted ? '#ff0000' : '#00ff8833'} strokeWidth={1} style={{ transition: 'all 0.3s' }} />
            <text x={130} y={213} textAnchor="middle" fill={halted ? C.danger : C.accent} fontSize={9} fontFamily={FONT} fontWeight="700">CONTROL UNIT</text>
            <text x={130} y={228} textAnchor="middle" fill="#aaa" fontSize={8} fontFamily={FONT}>DECODE: {mnem}</text>
            <text x={130} y={242} textAnchor="middle" fill="#666" fontSize={7} fontFamily={FONT}>PC: {hex2(pc)} | SP: {hex2(sp)}</text>
            <text x={130} y={256} textAnchor="middle" fill={halted ? C.danger : C.accent} fontSize={8} fontFamily={FONT} fontWeight="700">{halted ? '■ HALTED' : '● RUNNING'}</text>
            {/* ALU */}
            <polygon points="490,140 580,160 580,240 490,260 470,200" fill="#ff990010" stroke={C.warn} strokeWidth={1} />
            <text x={520} y={195} textAnchor="middle" fill={C.warn} fontSize={11} fontFamily={FONT} fontWeight="700">ALU</text>
            <text x={520} y={210} textAnchor="middle" fill="#666" fontSize={8} fontFamily={FONT}>+−&amp;|^~</text>
            <text x={520} y={224} textAnchor="middle" fill="#555" fontSize={7} fontFamily={FONT}>SHL SHR</text>
            {/* Register file */}
            <rect x={620} y={100} width={55} height={200} rx={4} fill="#0a0a0a" stroke="#333" strokeWidth={0.8} />
            <text x={648} y={116} textAnchor="middle" fill="#666" fontSize={7} fontFamily={FONT} fontWeight="700">REGS</text>
            {regs.map((v, i) => {
                const yy = 122 + i * 22; const active = lastAccess.reg === i;
                return (<g key={i}>
                    <rect x={624} y={yy} width={47} height={18} rx={2} fill={active ? '#00ff8820' : 'transparent'} />
                    <text x={630} y={yy + 13} fill={active ? C.accent : '#555'} fontSize={8} fontFamily={FONT}>R{i}</text>
                    <text x={666} y={yy + 13} textAnchor="end" fill={active ? C.accent : '#777'} fontSize={9} fontFamily={FONT} fontWeight="700">{hex2(v)}</text>
                </g>);
            })}
            {/* Flags */}
            <rect x={470} y={270} width={200} height={55} rx={4} fill="#0a0a0a" stroke="#222" strokeWidth={0.8} />
            <text x={570} y={284} textAnchor="middle" fill="#555" fontSize={7} fontFamily={FONT} fontWeight="700">FLAGS</text>
            {['Z', 'C', 'N', 'V'].map((f, i) => {
                const on = flags[f]; const fx = 480 + i * 47;
                return (<g key={f}>
                    <rect x={fx} y={290} width={38} height={28} rx={3} fill={on ? '#00ff8820' : '#050505'} stroke={on ? C.accent : '#222'} strokeWidth={0.8} />
                    <text x={fx + 19} y={302} textAnchor="middle" fill={on ? C.accent : '#444'} fontSize={9} fontFamily={FONT} fontWeight="700">{f}</text>
                    <text x={fx + 19} y={314} textAnchor="middle" fill={on ? '#fff' : '#333'} fontSize={9} fontFamily={FONT}>{on ? '1' : '0'}</text>
                </g>);
            })}
            {/* Clock */}
            {box(30, 285, 130, 55, 'CLOCK', `${clock}`, 'CYCLES', C.cyan, true)}
            {/* Bus bars */}
            <rect x={0} y={360} width={700} height={10} rx={2} fill={lastAccess.bus === 'data' ? '#00ff8820' : '#111'} stroke={lastAccess.bus === 'data' ? C.accent : '#222'} strokeWidth={0.8} style={{ transition: 'all 0.3s' }} />
            <text x={350} y={368} textAnchor="middle" fill={lastAccess.bus === 'data' ? C.accent : '#333'} fontSize={6} fontFamily={FONT}>DATA BUS (8-bit)</text>
            <rect x={0} y={375} width={700} height={10} rx={2} fill={lastAccess.bus === 'address' ? '#00ccff20' : '#111'} stroke={lastAccess.bus === 'address' ? C.cyan : '#222'} strokeWidth={0.8} style={{ transition: 'all 0.3s' }} />
            <text x={350} y={383} textAnchor="middle" fill={lastAccess.bus === 'address' ? C.cyan : '#333'} fontSize={6} fontFamily={FONT}>ADDRESS BUS (8-bit)</text>
            {/* Connection lines */}
            <line x1={460} y1={200} x2={490} y2={200} stroke={C.warn} strokeWidth={0.8} opacity={0.4} />
            <line x1={580} y1={200} x2={620} y2={200} stroke={C.accent} strokeWidth={0.8} opacity={0.4} markerEnd="url(#arr)" />
            <line x1={230} y1={195} x2={230} y2={165} stroke="#555" strokeWidth={0.6} opacity={0.3} />
        </svg>
    );
}

// ═══════════ CONTROL PANEL ═══════════
function ControlPanel({ cpu, onStep, onRun, onPause, onReset, running, speed, setSpeed }) {
    const [hov, setHov] = useState(null);
    const btn = (label, color, onClick, disabled, id) => (
        <button key={id} disabled={disabled} onMouseEnter={() => setHov(id)} onMouseLeave={() => setHov(null)} onClick={onClick} style={{ flex: 1, padding: '10px 0', background: disabled ? '#111' : hov === id ? `${color}25` : `${color}15`, border: `1px solid ${disabled ? '#333' : color}`, color: disabled ? '#444' : color, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 700, transition: 'all 0.2s', ...(disabled ? {} : { boxShadow: hov === id ? `0 0 12px ${color}44` : 'none' }) }}>{label}</button>
    );
    return (
        <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {btn('RESET', C.danger, onReset, false, 'rst')}
                {btn('STEP', C.accent, onStep, cpu.halted || running, 'stp')}
                {btn(running ? 'PAUSE' : 'RUN', running ? C.warn : C.cyan, running ? onPause : onRun, cpu.halted, 'run')}
            </div>
            <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT, fontSize: 10, color: '#666', marginBottom: 4 }}>
                    <span>CLOCK SPEED</span><span style={{ color: C.cyan }}>{speed} Hz</span>
                </div>
                <input type="range" min={1} max={20} value={speed} onChange={e => setSpeed(+e.target.value)} style={{ width: '100%', accentColor: C.cyan }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT, fontSize: 8, color: '#444' }}><span>1 Hz</span><span>20 Hz</span></div>
            </div>
            <div style={{ background: '#050505', border: '1px solid #1a1a1a', borderRadius: 6, padding: 8, marginBottom: 10 }}>
                <div style={{ fontFamily: FONT, fontSize: 8, color: '#444', marginBottom: 4, letterSpacing: 1 }}>MICRO-OPERATION LOG</div>
                <div style={{ fontFamily: FONT, fontSize: 11, color: cpu.halted ? C.danger : C.accent, minHeight: 36, transition: 'all 0.3s' }}>{cpu.microOp || '— idle —'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
                {[['CYCLES', cpu.clock, C.cyan], ['PC', `0x${hex2(cpu.pc)}`, C.accent], ['STATUS', cpu.halted ? 'HALT' : 'RUN', cpu.halted ? C.danger : C.accent]].map(([l, v, c]) => (
                    <div key={l} style={{ flex: 1, background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 6, padding: '6px 0', textAlign: 'center' }}>
                        <div style={{ fontFamily: FONT, fontSize: 8, color: '#444', letterSpacing: 1 }}>{l}</div>
                        <div style={{ fontFamily: FONT, fontSize: 13, color: c, fontWeight: 700 }}>{v}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ═══════════ MAIN APP ═══════════
export default function App() {
    const [cpu, setCpu] = useState(createCPU);
    const [running, setRunning] = useState(false);
    const [speed, setSpeed] = useState(3);
    const [log, setLog] = useState([]);
    const [showRef, setShowRef] = useState(false);
    const runRef = useRef(false);
    const cpuRef = useRef(cpu);
    cpuRef.current = cpu;

    const step = useCallback(() => {
        const next = cpuStep(cpuRef.current);
        setCpu(next); cpuRef.current = next;
        setLog(prev => [next.microOp, ...prev].slice(0, 50));
        return next;
    }, []);

    const handleRun = useCallback(() => { setRunning(true); runRef.current = true; }, []);
    const handlePause = useCallback(() => { setRunning(false); runRef.current = false; }, []);
    const handleReset = useCallback(() => {
        setRunning(false); runRef.current = false;
        const fresh = createCPU();
        const mem = cpuRef.current.memory;
        fresh.memory = [...mem];
        setCpu(fresh); cpuRef.current = fresh; setLog([]);
    }, []);
    const handleLoad = useCallback(bytes => {
        setRunning(false); runRef.current = false;
        const fresh = createCPU();
        bytes.forEach((b, i) => { if (i < 256) fresh.memory[i] = b & 0xFF; });
        setCpu(fresh); cpuRef.current = fresh; setLog([]);
    }, []);
    const handleExport = useCallback(src => {
        const blob = new Blob([src], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'program.asm'; a.click();
    }, []);

    useEffect(() => {
        if (!running) return;
        const id = setInterval(() => {
            if (!runRef.current) { clearInterval(id); return; }
            const next = step();
            if (next.halted) { setRunning(false); runRef.current = false; clearInterval(id); }
        }, 1000 / speed);
        return () => clearInterval(id);
    }, [running, speed, step]);

    return (
        <div style={{ background: C.bg, minHeight: '100vh', fontFamily: FONT, color: '#ccc' }}>
            {/* HEADER */}
            <div style={{ background: 'linear-gradient(180deg, #00ff8808 0%, transparent 100%)', borderBottom: '1px solid #00ff8822', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ color: C.accent, fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>⬡ 8-BIT CPU SIMULATOR</div>
                    <div style={{ color: '#444', fontSize: 9, letterSpacing: 1 }}>VON NEUMANN ARCHITECTURE · FETCH–DECODE–EXECUTE</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button onClick={() => setShowRef(!showRef)} style={{ background: 'none', border: `1px solid ${showRef ? C.accent : '#333'}`, color: showRef ? C.accent : '#555', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 700, transition: 'all 0.2s' }}>?</button>
                    <div style={{ textAlign: 'right' }}>
                        <span style={{ color: '#555', fontSize: 9 }}>CLK </span><span style={{ color: C.cyan, fontSize: 11, fontWeight: 700 }}>{speed}Hz</span>
                        <span style={{ color: '#333', margin: '0 6px' }}>|</span>
                        <span style={{ color: '#555', fontSize: 9 }}>CYC </span><span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}>{cpu.clock}</span>
                    </div>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: running ? C.accent : '#333', boxShadow: running ? `0 0 12px ${C.accent}, 0 0 24px ${C.accent}44` : 'none', transition: 'all 0.3s' }} />
                </div>
            </div>

            {/* INSTRUCTION REFERENCE */}
            {showRef && (
                <div style={{ background: '#060606', border: '1px solid #1a1a1a', margin: '0 14px', borderRadius: '0 0 10px 10px', padding: 14, maxHeight: 260, overflowY: 'auto' }}>
                    <div style={{ ...secHdr(), marginBottom: 6 }}>▸ Instruction Set Reference (21 Instructions)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                        {INSTR_REF.map(([syn, enc, desc], i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 6px', background: i % 2 === 0 ? '#0a0a0a' : 'transparent', borderRadius: 3, fontSize: 9, fontFamily: FONT }}>
                                <span style={{ color: C.accent, minWidth: 120 }}>{syn}</span>
                                <span style={{ color: '#555', minWidth: 60 }}>{enc}</span>
                                <span style={{ color: '#777' }}>{desc}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MAIN GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: 12, padding: 14 }}>
                {/* LEFT */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={card}><ControlPanel cpu={cpu} onStep={step} onRun={handleRun} onPause={handlePause} onReset={handleReset} running={running} speed={speed} setSpeed={setSpeed} /></div>
                    <div style={card}><AssemblyEditor onLoad={handleLoad} onExport={handleExport} /></div>
                </div>
                {/* CENTER */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={card}>
                        <div style={secHdr()}>▸ CPU Architecture Diagram</div>
                        <CPUDiagram cpu={cpu} />
                    </div>
                    <div style={card}>
                        <div style={secHdr()}>▸ Execution Log</div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                            {log.length === 0 ? <div style={{ color: '#333', fontFamily: FONT, fontSize: 10, textAlign: 'center', padding: 12 }}>— no operations yet —</div>
                                : log.map((entry, i) => (
                                    <div key={i} style={{ fontFamily: FONT, fontSize: 10, padding: '2px 6px', borderRadius: 3, color: i === 0 ? C.accent : '#777', background: i === 0 ? '#00ff8808' : 'transparent', opacity: Math.max(0.2, 1 - i * 0.04), transition: 'all 0.2s' }}>
                                        <span style={{ color: '#333', marginRight: 6 }}>{String(log.length - i).padStart(3, '0')}</span>{entry}
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
                {/* RIGHT */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={card}><RegisterPanel regs={cpu.regs} lastAccess={cpu.lastAccess} flags={cpu.flags} pc={cpu.pc} sp={cpu.sp} ir={cpu.ir} mar={cpu.mar} mdr={cpu.mdr} /></div>
                    <div style={card}><MemoryGrid memory={cpu.memory} pc={cpu.pc} lastAccess={cpu.lastAccess} sp={cpu.sp} /></div>
                </div>
            </div>

            {/* FOOTER */}
            <div style={{ textAlign: 'center', padding: '10px 0', color: '#222', fontSize: 9, letterSpacing: 2, fontFamily: FONT, borderTop: '1px solid #0a0a0a' }}>
                8-BIT CPU SIMULATOR · VON NEUMANN MODEL · 256-BYTE UNIFIED MEMORY · 21 INSTRUCTIONS
            </div>
        </div>
    );
}

