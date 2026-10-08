import { Badge, timeLabel, type Navigate, type WorkspaceView } from './Dashboard.js';
import { Icon } from './ui.js';
import type {Agent,Grant,Policy,Service,Endpoint,IntegrationKey,Approval,Activity,DashboardData} from './control-types.js';

function Fields({rows}:{rows:[string,unknown][]}) {
  return <dl className="dbFields">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value===null||value===undefined||value===''?'—':Array.isArray(value)?value.join(', '):String(value)}</dd></div>)}</dl>;
}
export function ResourceDetail({view,id,agents,grants,policies,services,endpoints,keys,approvals,activity,agentActivity,data,navigate,manage}:{
  view:WorkspaceView;id:string;agents:Agent[];grants:Grant[];policies:Policy[];services:Service[];endpoints:Endpoint[];
  keys:IntegrationKey[];approvals:Approval[];activity?:Activity;agentActivity:Activity[];data?:DashboardData;navigate:Navigate;manage:()=>void;
}) {
  const agent=agents.find(x=>x.id===id),grant=grants.find(x=>x.id===id),policy=policies.find(x=>x.id===id);
  const endpoint=endpoints.find(x=>x.id===id),service=services.find(x=>x.id===id),key=keys.find(x=>x.id===id),approval=approvals.find(x=>x.id===id);
  const record=view==='agents'?agent:view==='grants'?grant:view==='policies'?policy:view==='endpoints'?endpoint??service:view==='keys'?key:view==='approvals'?approval:activity;
  if(!record)return <section className="cpCard"><button className="dbMore" onClick={()=>navigate(view)}>← Back to {view}</button><h2>Details unavailable</h2><p>Refresh the collection or check account access.</p></section>;
  const name='name' in record?record.name:view==='activity'?'Request details':view==='approvals'?'Approval request':endpoint?`${endpoint.method} ${endpoint.path_pattern}`:'Details';
  const relatedAgent='agent_id' in record?agents.find(x=>x.id===record.agent_id):agent;
  const usage=data?.agentStats.find(x=>x.agent_id===(agent?.id??relatedAgent?.id));
  const related=(title:string,items:{id:string;name:string;status?:string}[],target:WorkspaceView)=><section className="cpCard"><div className="dbPanelHead"><h2>{title} <small>{items.length}</small></h2><button className="dbMore" onClick={()=>navigate(target)}>View more <Icon name="arrow" size={14}/></button></div>{items.length?items.map(item=><button className="dbEvent" key={item.id} onClick={()=>navigate(target,item.id)}><span><strong>{item.name}</strong>{item.status&&<small>{item.status}</small>}</span><Icon name="arrow" size={14}/></button>):<div className="dbEmpty">No {title.toLowerCase()}</div>}</section>;
  return <div className="dbResourcePage"><div className="dbToolbar"><button className="dbMore" onClick={()=>navigate(view)}>← Back to {view==='keys'?'API keys':view}</button>{view!=='activity'&&<button className="cpPrimary" onClick={manage}>{view==='approvals'?'Review request':'Manage'}</button>}</div>
    <section className="cpCard dbResourceHero"><div className="dbAgentName"><span className="cpAvatar"><Icon name={view==='agents'?'agent':'shield'} size={25}/></span><div><span className="cpEyebrow">{view==='agents'?'AGENT PROFILE':view.toUpperCase()}</span><h2>{name}</h2><code>{id}</code></div></div>{'status' in record&&<Badge value={record.status}/>}<Fields rows={[
      ...(view==='agents'&&agent?[['Environment',agent.environment],['Last seen',timeLabel(usage?.last_seen)],['Description',agent.description]] as [string,unknown][]:[]),
      ...(relatedAgent&&view!=='agents'?[['Agent',relatedAgent.name]] as [string,unknown][]:[]),
    ]}/></section>
    {view==='agents'&&agent&&<><div className="dbMetrics">{[['Requests · 24h',usage?.requests??0],['Allowed',usage?.allowed??0],['Denied',usage?.denied??0],['Active keys',data?.keyStats.find(x=>x.agent_id===id)?.active??0]].map(([label,value])=><div className="dbMetric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="cpTwo">
      {related('Grants',grants.filter(x=>x.agent_id===id),'grants')}
      {related('Policies',policies.filter(x=>x.agent_id===id),'policies')}
      {related('Endpoints',endpoints.filter(x=>x.agent_id===id).map(x=>({id:x.id,name:`${x.method} ${x.path_pattern}`,status:x.status})),'endpoints')}
      {related('API keys',keys.map(x=>({id:x.id,name:x.name,status:x.revoked_at?'revoked':Date.parse(x.expires_at)<=Date.now()?'expired':'active'})),'keys')}
      <section className="cpCard"><h2>Services</h2>{services.filter(x=>x.agent_id===id).map(x=><button className="dbEvent" key={x.id} onClick={()=>navigate('endpoints',x.id)}><span><strong>{x.name}</strong><small>{x.base_url}</small><small>{x.auth_method} · {x.auth_method==='none'?'No credential required':x.has_secret?'Credential stored':'Credential missing'}</small></span><Icon name="arrow" size={14}/></button>)}</section>
      <section className="cpCard"><h2>Recent decisions</h2>{agentActivity.filter(x=>x.agent_id===id).slice(0,8).map(x=><button className="dbEvent" key={x.id} onClick={()=>navigate('activity',x.id)}><span><strong>{x.method} {x.route}</strong><small>{timeLabel(x.created_at)}</small></span><Badge value={x.decision}/></button>)}<button className="dbMore" onClick={()=>navigate('activity')}>View more activity <Icon name="arrow" size={14}/></button></section>
    </div></>}
    {view==='grants'&&grant&&<section className="cpCard"><h2>Authority bounds</h2><Fields rows={[
      ['Owner',grant.principal_address],['Actions',grant.actions],['Resources',grant.resource_origins],['Destinations',grant.destination_origins],['Recipients',grant.allowed_recipients],['Currency',grant.currency],['Per action · minor units',grant.per_action_limit_minor],['Aggregate · minor units',grant.aggregate_limit_minor],['Spent · minor units',grant.spent_minor],['Approval above · minor units',grant.approval_threshold_minor],['Starts',timeLabel(grant.starts_at)],['Expires',timeLabel(grant.expires_at)]]}/></section>}
    {view==='policies'&&policy&&<section className="cpCard"><h2>Ordered rules <small>v{policy.version}</small></h2><p>First match wins. No match denies.</p>{policy.rules.map((rule,index)=><div className="dbPolicyRule" key={rule.id}><div><span className="cpAvatar">{index+1}</span><strong>{rule.name}</strong><Badge value={rule.effect}/></div><Fields rows={[
      ['Rule ID',rule.id],['Methods',rule.methods],['Paths',rule.paths],['Destinations',rule.destinations],['Rate limit',rule.maxRequests?`${rule.maxRequests} / ${rule.periodSeconds}s`:'None'],['Spend limit',rule.maxSpendMinor?`${rule.maxSpendMinor} ${rule.currency} minor units`:'None'],['UTC window',rule.windowUtc?`${rule.windowUtc.startHour}:00–${rule.windowUtc.endHour}:00`:'All hours']
    ]}/></div>)}</section>}
    {view==='endpoints'&&endpoint&&<section className="cpCard"><h2>Operation</h2><Fields rows={[
      ['Method',endpoint.method],['Path',endpoint.path_pattern],['Base URL',endpoint.base_url],['Policy',endpoint.policy_name],['Grant',grants.find(x=>x.id===endpoint.grant_id)?.name],['Cost · minor units',`${endpoint.cost_minor} ${endpoint.currency}`],['Returned fields',endpoint.response_fields],['Last used',timeLabel(endpoint.last_used_at)],['Description',endpoint.description]]}/><div className="cpActions"><button onClick={()=>navigate('grants',endpoint.grant_id)}>View grant</button><button onClick={()=>navigate('policies',endpoint.policy_id)}>View policy</button></div></section>}
    {view==='endpoints'&&!endpoint&&service&&<section className="cpCard"><h2>Upstream service</h2><Fields rows={[
      ['Base URL',service.base_url],['Authentication',service.auth_method],['Header',service.auth_header],['Credential',service.auth_method==='none'?'Not required':service.has_secret?'Stored':'Missing']
    ]}/>{related('Endpoints',endpoints.filter(x=>x.service_id===id).map(x=>({id:x.id,name:`${x.method} ${x.path_pattern}`,status:x.status})),'endpoints')}</section>}
    {view==='keys'&&key&&<section className="cpCard"><h2>Credential</h2><Fields rows={[
      ['Prefix',key.prefix],['Scopes',key.scopes],['Expires',timeLabel(key.expires_at)],['Last used',timeLabel(key.last_used_at)],['Revoked',key.revoked_at?timeLabel(key.revoked_at):'No']
    ]}/><p>Authentication only. Grants determine authority.</p></section>}
    {view==='approvals'&&approval&&<section className="cpCard"><h2>Requested action</h2><Fields rows={[
      ['State',approval.state],['Method',approval.method],['Path',approval.path_pattern],['Grant',approval.grant_name],['Policy',approval.policy_name],['Matched rule',approval.matched_rule],['Cost · minor units',`${approval.cost_minor} ${approval.currency}`],['Expires',timeLabel(approval.expires_at)],['Request hash',approval.request_hash]
    ]}/></section>}
    {view==='activity'&&activity&&<section className="cpCard"><h2>Decision trace</h2><Fields rows={[
      ['Decision',activity.decision],['Method',activity.method],['Route',activity.route],['Time',timeLabel(activity.created_at)],['Reason',activity.reason],['Upstream status',activity.upstream_status],['Latency',activity.latency_ms==null?'—':`${activity.latency_ms} ms`],['Execution',activity.execution_state]]}/>{activity.trace.map((step,i)=><div className="dbTrace" key={i}><span>{i+1}</span><div><strong>{step.name}</strong><small>{step.ruleId} · {step.reason}</small></div><Badge value={step.result}/></div>)}<div className="cpActions">{activity.grant_id&&<button onClick={()=>navigate('grants',activity.grant_id!)}>View grant</button>}{activity.policy_id&&<button onClick={()=>navigate('policies',activity.policy_id!)}>View policy</button>}</div><small>Private gateway log · not an onchain receipt</small></section>}
  </div>;
}
