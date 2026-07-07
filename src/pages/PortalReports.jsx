import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StageAdminDashboard from './StageAdminDashboard';

/**
 * Thin route-level wrapper that makes StageAdminDashboard
 * addressable as a standalone /portal/reports page.
 * Sources `servant` and `formData` from the live auth context.
 */
export default function PortalReports() {
    const { servant, isGeneralAdmin, isServant, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400" />
            </div>
        );
    }

    // Guard: must be stage admin or general admin (also enforced by ProtectedRoute)
    if (!isGeneralAdmin && (!isServant || servant?.role !== 'أمين مرحلة')) {
        return <Navigate to="/portal/profile" replace />;
    }

    // Construct the minimal formData shape StageAdminDashboard expects
    const servantData = servant || {};
    const formData = {
        name: typeof servantData.name === 'object' ? servantData.name?.name : (servantData.name || ''),
        phone: servantData.phone || '',
        address: servantData.address || '',
    };

    // General admin sees the first available stage
    const adminServantProxy = isGeneralAdmin
        ? { assignedStage: 'ابتدائي', managedClasses: [], role: 'أمين مرحلة', ...servantData }
        : servantData;

    return <StageAdminDashboard servant={adminServantProxy} formData={formData} />;
}
