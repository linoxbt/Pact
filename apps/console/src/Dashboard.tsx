import { Icon } from './ui.js';
import type {Agent,Grant,Policy,Endpoint,Approval,DashboardData} from './control-types.js';

export type WorkspaceView='overview'|'agents'|'grants'|'endpoints'|'policies'|'keys'|'approvals'|'activity'|'audit'|'account'|'verification';
export type Navigate=(view:WorkspaceView,id?:string)=>void;
export const timeLabel=(value?:string|null)=>value?new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No activity';
export const Badge=({value}:{value:string})=><span className={`cpBadge ${value}`}>{value.replaceAll('_',' ')}</span>;
function Heading({title,detail,onMore}:{title:string;detail?:string;onMore:()=>void}) {
  return <div className="dbPanelHead"><div><h2>{title}</h2>{detail&&<small>{detail}</small>}</div><button className="dbMore" onClick={onMore} aria-label={`View more ${title.toLowerCase()}`}>View more <Icon name="arrow" size={14}/></button></div>;
}
export function Dashboard({agents,grants,policies,endpoints,approvals,data,error,navigate,retry}:{
  agents:Agent[];grants:Grant[];policies:Policy[];endpoints:Endpoint[];approvals:Approval[];
  data?:DashboardData;error:string;navigate:Navigate;retry:()=>void;
}) {
  const pending=approvals.filter(x=>x.state==='pending'&&Date.parse(x.expires_at)>Date.now());
  const stats=data?.stats;
  const activeGrants=grants.filter(x=>x.status==='active'&&Date.parse(x.starts_at)<=Date.now()&&Date.parse(x.expires_at)>Date.now());
  const maximum=Math.max(1,...(data?.hourly??[]).map(x=>x.allowed+x.denied+x.pending));
  const hours=Array.from({length:25},(_,i)=>{
    const since=new Date(data?.since??Date.now()-86_400_000).getTime();
    const start=new Date(Math.floor(since/3_600_000)*3_600_000+i*3_600_000);
    return {time:start,...data?.hourly.find(x=>Date.parse(x.hour)===start.getTime())};
  });
  const sorted=[...agents].sort((a,b)=>Date.parse(data?.agentStats.find(x=>x.agent_id===b.id)?.last_seen??'1970-01-01')-Date.parse(data?.agentStats.find(x=>x.agent_id===a.id)?.last_seen??'1970-01-01'));
  return <div className="dbDashboard">
    <div className="dbToolbar"><span><i className="cpPulse"/>{data?`Updated ${new Date(data.updatedAt).toLocaleTimeString()}`:'Loading metrics…'}</span><div><button onClick={()=>navigate('verification')}><Icon name="shield" size={15}/> Test enforcement</button><button className="cpPrimary" onClick={()=>navigate('agents')}><Icon name="agent" size={15}/> Connect agent</button></div></div>
    {error&&<div className="cpNotice" role="alert">{error}<button onClick={retry}>Retry</button></div>}
    <div className="dbMetrics">{[
      {label:'Active agents',value:agents.filter(x=>x.status==='active').length,detail:`${agents.length} registered`,icon:'agent',view:'agents'},
      {label:'Requests',value:stats?.requests.toLocaleString()??'—',detail:'Last 24 hours',icon:'activity',view:'activity'},
      {label:'Denied',value:stats?.denied.toLocaleString()??'—',detail:stats?.requests?`${Math.round(stats.denied/stats.requests*100)}% of requests`:'Last 24 hours',icon:'shield',view:'activity'},
      {label:'Awaiting approval',value:pending.length,detail:'Open requests',icon:'inbox',view:'approvals'},
    ].map(item=><button className="dbMetric" key={item.label} onClick={()=>navigate(item.view as WorkspaceView)}><span>{item.label}<Icon name={item.icon} size={18}/></span><strong>{item.value}</strong><small>{item.detail}<Icon name="arrow" size={13}/></small></button>)}</div>
    <div className="dbAnalytics"><section className="cpCard dbChartPanel"><Heading title="Request activity" detail="Last 24 hours · hourly decisions" onMore={()=>navigate('activity')}/>
      <div className="dbChartSummary"><strong>{stats?.requests.toLocaleString()??'—'}<small>requests</small></strong><div><span><i className="allowed"/>Allowed <b>{stats?.allowed??'—'}</b></span><span><i className="denied"/>Denied <b>{stats?.denied??'—'}</b></span><span><i className="pending"/>Approval <b>{stats?.pending??'—'}</b></span></div></div>
      <div className="dbChart" role="img" aria-label={`Last 24 hours: ${stats?.allowed??0} allowed, ${stats?.denied??0} denied, ${stats?.pending??0} pending approval`}>
        {hours.map((hour,i)=><div className="dbBarSlot" key={i} title={`${hour.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}: ${hour.allowed??0} allowed, ${hour.denied??0} denied, ${hour.pending??0} pending`}>
          <div className="dbBar" style={{height:`${((hour.allowed??0)+(hour.denied??0)+(hour.pending??0))/maximum*100}%`}}>
            <i className="pending" style={{flex:hour.pending??0}}/><i className="denied" style={{flex:hour.denied??0}}/><i className="allowed" style={{flex:hour.allowed??0}}/>
          </div></div>)}
        {data&&!stats?.requests&&<span className="dbChartEmpty">No requests in this period</span>}
      </div><div className="dbAxis"><span>{hours[0].time.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span><span>12 hours ago</span><span>Now</span></div>
    </section><section className="cpCard dbCoverage"><Heading title="Authority" onMore={()=>navigate('grants')}/>
      {([{label:'Active grants',value:activeGrants.length,view:'grants'}, {label:'Active policies',value:policies.filter(x=>x.status==='active').length,view:'policies'},
        {label:'Enabled endpoints',value:endpoints.filter(x=>x.status==='active').length,view:'endpoints'},
        {label:'Active API keys',value:data?.keyStats.reduce((n,x)=>n+x.active,0)??'—',view:'keys'}] as const).map(item=><button key={item.label} onClick={()=>navigate(item.view)}><span>{item.label}</span><strong>{item.value}</strong><Icon name="arrow" size={14}/></button>)}
      <div className="dbLatency"><span>Average upstream latency<small>Responded requests · 24h</small></span><strong>{stats?.latency_ms==null?'—':`${stats.latency_ms} ms`}</strong></div>
    </section></div>
    <section className="cpCard dbAgents"><Heading title="Agents" detail={`${agents.length} registered · sorted by recent activity`} onMore={()=>navigate('agents')}/>
      {agents.length?<div className="dbTableWrap"><table className="dbTable"><thead><tr><th>Agent</th><th>Status</th><th>Authority</th><th>Requests · 24h</th><th>Last seen</th><th/></tr></thead><tbody>{sorted.slice(0,5).map(agent=>{
        const usage=data?.agentStats.find(x=>x.agent_id===agent.id);
        return <tr key={agent.id}><td><div className="dbAgentName"><span className="cpAvatar"><Icon name="agent" size={18}/></span><div><strong>{agent.name}</strong><small>{agent.environment}</small></div></div></td><td><Badge value={agent.status}/></td><td><strong>{grants.filter(x=>x.agent_id===agent.id).length} grants</strong><small>{endpoints.filter(x=>x.agent_id===agent.id).length} endpoints · {data?.keyStats.find(x=>x.agent_id===agent.id)?.active??0} active keys</small></td><td><strong>{usage?.requests??0}</strong><small>{usage?.denied??0} denied · {usage?.latency_ms==null?'—':`${usage.latency_ms} ms`}</small></td><td><small>{timeLabel(usage?.last_seen)}</small></td><td><button className="dbMore" onClick={()=>navigate('agents',agent.id)} aria-label={`View ${agent.name}`}>View more <Icon name="arrow" size={14}/></button></td></tr>;
      })}</tbody></table></div>:<div className="dbEmpty"><Icon name="agent" size={25}/><strong>No agents connected</strong><button onClick={()=>navigate('agents')}>Connect your first agent</button></div>}
    </section>
    <div className="dbAnalytics"><section className="cpCard"><Heading title="Recent activity" onMore={()=>navigate('activity')}/>{data?.recent.length?data.recent.slice(0,5).map(event=><button className="dbEvent" key={event.id} onClick={()=>navigate('activity',event.id)}><span className={`dbEventDot ${event.decision}`}/><span><strong>{event.agent_name}</strong><small>{event.method} {event.route}</small></span><span><Badge value={event.decision}/><small>{timeLabel(event.created_at)}</small></span><Icon name="arrow" size={14}/></button>):<div className="dbEmpty">No recorded requests</div>}</section>
    <section className="cpCard"><Heading title="Approvals" detail={`${pending.length} pending`} onMore={()=>navigate('approvals')}/>{pending.length?pending.slice(0,3).map(item=><button className="dbEvent" key={item.id} onClick={()=>navigate('approvals',item.id)}><span className="cpAvatar"><Icon name="inbox" size={17}/></span><span><strong>{item.agent_name}</strong><small>{item.method} {item.path_pattern}</small><small>Expires {timeLabel(item.expires_at)}</small></span><Icon name="arrow" size={14}/></button>):<div className="dbEmpty"><Icon name="check" size={24}/><strong>Inbox clear</strong><small>No requests waiting for review</small></div>}</section></div>
  </div>;
}
