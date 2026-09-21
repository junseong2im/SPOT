import type {Metadata} from 'next';
import {HealthDashboard} from './health-dashboard';
export const metadata:Metadata={title:'건강 대시보드 | SPOT',description:'나만의 신체·식단·유산소·컨디션 기록을 관리하세요.'};
export const dynamic='force-dynamic';
export default function HealthPage(){return <HealthDashboard/>;}
