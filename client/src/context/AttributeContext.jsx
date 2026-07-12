import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { wsEvents } from '../utils/wsEvents';

const AttributeContext = createContext();

export const useAttributes = () => {
    const context = useContext(AttributeContext);
    if (!context) {
        throw new Error('useAttributes must be used within an AttributeProvider');
    }
    return context;
};

export const AttributeProvider = ({ children }) => {
    const [attributeClasses, setAttributeClasses] = useState([]);
    const [loading, setLoading] = useState(true);

    const mapClasses = raw => raw.map(c => ({
        id: c.attributeClassId,
        name: c.name,
        type: c.type,
        values: (c.values || []).map(v => ({ id: v.attributeValueId, value: v.value })),
    }));

    const refreshAttributes = useCallback(async () => {
        try {
            const raw = await api.attributeService.getAll();
            setAttributeClasses(mapClasses(raw));
        } catch (err) {
            console.error('Failed to load attribute classes', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refreshAttributes(); }, [refreshAttributes]);
    useEffect(() => wsEvents.on('attributes_updated', refreshAttributes), [refreshAttributes]);

    const createAttributeClass = useCallback(async (name, type = 'list') => {
        await api.attributeService.createClass(name, type);
        await refreshAttributes();
    }, [refreshAttributes]);

    const renameAttributeClass = useCallback(async (classId, name) => {
        await api.attributeService.renameClass(classId, name);
        await refreshAttributes();
    }, [refreshAttributes]);

    const deleteAttributeClass = useCallback(async (classId) => {
        await api.attributeService.deleteClass(classId);
        await refreshAttributes();
    }, [refreshAttributes]);

    const addAttributeValue = useCallback(async (classId, value) => {
        await api.attributeService.addValue(classId, value);
        await refreshAttributes();
    }, [refreshAttributes]);

    const renameAttributeValue = useCallback(async (valueId, value) => {
        await api.attributeService.renameValue(valueId, value);
        await refreshAttributes();
    }, [refreshAttributes]);

    const deleteAttributeValue = useCallback(async (valueId) => {
        await api.attributeService.deleteValue(valueId);
        await refreshAttributes();
    }, [refreshAttributes]);

    const value = useMemo(() => ({
        attributeClasses,
        loading,
        createAttributeClass,
        renameAttributeClass,
        deleteAttributeClass,
        addAttributeValue,
        renameAttributeValue,
        deleteAttributeValue,
        refreshAttributes,
    }), [attributeClasses, loading, createAttributeClass, renameAttributeClass, deleteAttributeClass, addAttributeValue, renameAttributeValue, deleteAttributeValue, refreshAttributes]);

    return (
        <AttributeContext.Provider value={value}>
            {children}
        </AttributeContext.Provider>
    );
};
