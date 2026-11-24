import { dlopen, FFIType, type Pointer } from "bun:ffi";

// PROCESS_SET_QUOTA | PROCESS_TERMINATE, what AssignProcessToJobObject needs
const ACCESS = 0x0101;

// JobObjectBasicAccountingInformation: 48 bytes, ActiveProcesses a DWORD at 40
const ACCOUNTING = 1;
const INFO = 48;
const ACTIVE = 40;

function kernel32() {
  return dlopen("kernel32.dll", {
    CreateJobObjectW          : { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    OpenProcess               : { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
    AssignProcessToJobObject  : { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    QueryInformationJobObject : { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    TerminateJobObject        : { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    CloseHandle               : { args: [FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
}

let K32: ReturnType<typeof kernel32> | null = null;

export type WinJob = Pointer | bigint;

// a Windows job object (#212): what a process in it starts is in it too,
// so the job's processes are known by the object, never by a process id
// Windows may have given another process since
export namespace Win {

  // a job object holding the process pid; null if Windows refuses one
  export function job(pid: number): WinJob | null {
    try {
      K32 ??= kernel32();
    } catch {
      return null;
    }
    const job = K32.CreateJobObjectW(null, null);
    const proc = K32.OpenProcess(ACCESS, 0, pid);
    const ok = job !== null && proc !== null && K32.AssignProcessToJobObject(job, proc) !== 0;
    if (proc !== null) {
      K32.CloseHandle(proc);
    }
    if (!ok && job !== null) {
      K32.CloseHandle(job);
    }
    return ok ? job : null;
  }

  // how many of its processes run; null if Windows doesn't say
  export function running(job: WinJob): number | null {
    const info = new Uint8Array(INFO);
    return K32 !== null && K32.QueryInformationJobObject(job, ACCOUNTING, info, INFO, null) !== 0 ? new DataView(info.buffer).getUint32(ACTIVE, true) : null;
  }

  export function end(job: WinJob): void {
    K32?.TerminateJobObject(job, 1);
  }

  export function close(job: WinJob): void {
    K32?.CloseHandle(job);
  }

}
