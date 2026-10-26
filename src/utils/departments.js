export const DEPARTMENTS=['IT / Engineering','Human Resources (HR)','Finance / Accounts','Sales','Marketing','Operations'];
const aliases={engineering:DEPARTMENTS[0],it:DEPARTMENTS[0],'it / engineering':DEPARTMENTS[0],hr:DEPARTMENTS[1],'human resources':DEPARTMENTS[1],'human resources (hr)':DEPARTMENTS[1],finance:DEPARTMENTS[2],accounts:DEPARTMENTS[2],'finance / accounts':DEPARTMENTS[2],sales:DEPARTMENTS[3],marketing:DEPARTMENTS[4],operations:DEPARTMENTS[5]};
export const departmentName=name=>aliases[String(name||'').trim().toLowerCase()]||null;
