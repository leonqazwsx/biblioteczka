// Import-security, deduplication and stress fixtures must explicitly identify
// completed books. Tests for skipped/unknown rows use their own mixed CSV.
export function completedCsv(text){
 if(/exclusive shelf/i.test(text.split('\n')[0]))return Buffer.from(text);
 return Buffer.from(text.trimEnd().split('\n').map((line,index)=>line+(index?',read':',Exclusive Shelf')).join('\n')+'\n');
}
