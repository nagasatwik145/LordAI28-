import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { type CalendarEvent, uid } from "@/lib/lord-store";
import {
  detectCalendarEvent,
  createEventFromDetection,
  type DetectedEvent,
} from "@/lib/calendar-event-detector";
import { emitDashboardEvent } from "@/lib/dashboard-service";
import { format, parseISO, isSameDay, isAfter, isBefore, addDays, addHours } from "date-fns";

interface CalendarContextType {
  events: CalendarEvent[];
  addEvent: (event: CalendarEvent) => void;
  updateEvent: (id: string, event: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  toggleComplete: (id: string) => void;
  getUpcomingEvents: (days?: number) => CalendarEvent[];
  getTodaysEvents: () => CalendarEvent[];
  getTomorrowEvents: () => CalendarEvent[];
  detectAndCreateEvent: (text: string) => DetectedEvent | null;
}

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = usePersistedState<CalendarEvent[]>("calendar-events", []);

  const addEvent = (event: CalendarEvent) => {
    setEvents([event, ...events]);
    emitDashboardEvent("calendar");
  };

  const updateEvent = (id: string, updates: Partial<CalendarEvent>) => {
    setEvents(events.map((e) => (e.id === id ? { ...e, ...updates, updatedAt: Date.now() } : e)));
    emitDashboardEvent("calendar");
  };

  const deleteEvent = (id: string) => {
    setEvents(events.filter((e) => e.id !== id));
    emitDashboardEvent("calendar");
  };

  const toggleComplete = (id: string) => {
    setEvents(events.map((e) => (e.id === id ? { ...e, completed: !e.completed } : e)));
    emitDashboardEvent("calendar");
  };

  const getUpcomingEvents = (days = 7) => {
    const today = new Date();
    const future = addDays(today, days);
    return events
      .filter((e) => {
        const eventDate = parseISO(e.date);
        return isAfter(eventDate, today) && isBefore(eventDate, future) && !e.completed;
      })
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
  };

  const getTodaysEvents = () => {
    const today = new Date();
    return events.filter((e) => {
      const eventDate = parseISO(e.date);
      return isSameDay(eventDate, today) && !e.completed;
    });
  };

  const getTomorrowEvents = () => {
    const tomorrow = addDays(new Date(), 1);
    return events.filter((e) => {
      const eventDate = parseISO(e.date);
      return isSameDay(eventDate, tomorrow) && !e.completed;
    });
  };

  const detectAndCreateEvent = (text: string): DetectedEvent | null => {
    const detected = detectCalendarEvent(text);
    if (detected) {
      const event = createEventFromDetection(detected);
      addEvent(event);
    }
    return detected;
  };

  const value: CalendarContextType = {
    events,
    addEvent,
    updateEvent,
    deleteEvent,
    toggleComplete,
    getUpcomingEvents,
    getTodaysEvents,
    getTomorrowEvents,
    detectAndCreateEvent,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- custom hook is intentionally exported alongside the provider
export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error("useCalendar must be used within CalendarProvider");
  }
  return context;
}
